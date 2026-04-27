import re, os, time, glob, threading, asyncio, logging
from datetime import datetime
from watchdog.observers.polling import PollingObserver as Observer
from watchdog.events import FileSystemEventHandler
from database import SessionLocal, LogEntry, IngestedFile

logger = logging.getLogger(__name__)

LEVEL_MAP = {"ОШИБКА":"ERROR","СООБЩЕНИЕ":"INFO","ПОДРОБНОСТИ":"DEBUG","КОНТЕКСТ":"DEBUG","ОПЕРАТОР":"DEBUG","ЗАМЕЧАНИЕ":"WARN","ЗАПРОС":"DEBUG","ОТЛАДКА":"DEBUG"}
LOG_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+) MSK \[(\d+)\] (\S+)@(\S+) ([^:]+):\s+(.*)", re.DOTALL)
TSD_MARKERS = ["XCOOR","YCOOR","PRINTMODE","METHOD\tPRINT"]

# UUID терминала: XP-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
UUID_RE = re.compile(r"XP-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)

# Оператор: после ПОЛЬЗОВАТЕЛЬ: следующий TEXT\t...\x0bMETHOD
OPERATOR_RE = re.compile(
    r"ПОЛЬЗОВАТЕЛЬ:\x0bMETHOD\tPRINT\x0b(?:[^\x0b]*\x0b)*?TEXT\t([А-ЯЁа-яёA-Za-z][^\x0b]{1,40})\x0bMETHOD",
    re.DOTALL
)
# Запасной вариант
OPERATOR_RE2 = re.compile(
    r"ПОЛЬЗОВАТЕЛЬ:.*?TEXT\t([А-ЯЁа-яёA-Za-z][^\x0b\n]{1,40})\x0b",
    re.DOTALL
)

_broadcast_cb = None
_loop = None

def set_ws_broadcast(cb):
    global _broadcast_cb, _loop
    _broadcast_cb = cb
    try:
        _loop = asyncio.get_running_loop()
    except RuntimeError:
        _loop = None

def _fire(entry: LogEntry):
    if _broadcast_cb and _loop and entry.level_eng in ("ERROR","WARN"):
        data = {
            "type": "live",
            "id": entry.id,
            "timestamp": entry.timestamp.isoformat(),
            "level_eng": entry.level_eng,
            "database": entry.database,
            "msg": (entry.msg or "")[:200],
            "operator_name": entry.operator_name,
            "terminal_uuid": entry.terminal_uuid,
        }
        asyncio.run_coroutine_threadsafe(_broadcast_cb(data), _loop)

def extract_operator(msg: str) -> str | None:
    m = OPERATOR_RE.search(msg)
    if m:
        name = m.group(1).strip()
        if len(name) > 1 and not any(c in name for c in ["$","=","'","(",")"]):
            return name
    m = OPERATOR_RE2.search(msg)
    if m:
        name = m.group(1).strip()
        if len(name) > 1 and not any(c in name for c in ["$","=","'","(",")"]):
            return name
    return None

def extract_uuid(msg: str) -> str | None:
    m = UUID_RE.search(msg)
    return m.group(0) if m else None

def parse_line(raw: str):
    raw = raw.strip()
    if not raw: return None
    m = LOG_PATTERN.match(raw)
    if not m: return None
    ts_str, pid, db_user, database, level, msg = m.groups()
    level = level.strip()
    level_eng = LEVEL_MAP.get(level, "UNKNOWN")
    is_tsd = any(marker in msg for marker in TSD_MARKERS)

    operator_name = extract_operator(msg) if is_tsd else None
    terminal_uuid = extract_uuid(msg)

    try:
        timestamp = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")
    except ValueError:
        return None

    return LogEntry(
        timestamp=timestamp, pid=int(pid), db_user=db_user,
        database=database, level=level, level_eng=level_eng,
        msg=msg[:2000], is_tsd=1 if is_tsd else 0,
        operator_name=operator_name, terminal_uuid=terminal_uuid,
        raw=raw[:3000]
    )

def is_ingested(filepath: str) -> bool:
    db = SessionLocal()
    try:
        return db.query(IngestedFile).filter(IngestedFile.filename == os.path.basename(filepath)).first() is not None
    finally: db.close()

def mark_ingested(filepath: str, count: int):
    db = SessionLocal()
    try:
        existing = db.query(IngestedFile).filter(IngestedFile.filename == os.path.basename(filepath)).first()
        if existing: existing.entry_count = count; existing.ingested_at = datetime.utcnow()
        else: db.add(IngestedFile(filename=os.path.basename(filepath), entry_count=count))
        db.commit()
    finally: db.close()

def ingest_file(filepath: str, force: bool = False):
    if not force and is_ingested(filepath):
        print(f"[parser] Skip: {os.path.basename(filepath)}")
        return 0
    db = SessionLocal()
    batch = []; multiline_buf = []
    print(f"[parser] Ingesting {filepath}")
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if re.match(r"^\d{4}-\d{2}-\d{2}", line):
                    if multiline_buf:
                        entry = parse_line("\n".join(multiline_buf))
                        if entry: batch.append(entry)
                    multiline_buf = [line.rstrip()]
                else:
                    if multiline_buf: multiline_buf.append(line.rstrip())
            if multiline_buf:
                entry = parse_line("\n".join(multiline_buf))
                if entry: batch.append(entry)
        if batch:
            db.bulk_save_objects(batch); db.commit()
            mark_ingested(filepath, len(batch))
            logger.info("Saved %d from %s", len(batch), os.path.basename(filepath))
        else:
            mark_ingested(filepath, 0)
            logger.info("No parseable entries in %s, marked as ingested", os.path.basename(filepath))
        return len(batch)
    except Exception as e:
        logger.error("Error ingesting %s: %s", filepath, e)
        db.rollback()
        return 0
    finally: db.close()

def ingest_all(logs_path: str):
    for f in sorted(glob.glob(os.path.join(logs_path, "*.log"))):
        ingest_file(f)

def rescan_new(logs_path: str) -> list:
    files = sorted(glob.glob(os.path.join(logs_path, "*.log")))
    new_files = [f for f in files if not is_ingested(f)]
    return [{"file": os.path.basename(f), "entries": ingest_file(f)} for f in new_files]

class TailHandler:
    def __init__(self, filepath):
        self.filepath = filepath
        self.pos = os.path.getsize(filepath)
        self.buf = []

    def check(self):
        try:
            if os.path.getsize(self.filepath) <= self.pos: return
            with open(self.filepath, "r", encoding="utf-8", errors="replace") as f:
                f.seek(self.pos); new_data = f.read(); self.pos = f.tell()
            for line in new_data.splitlines(keepends=True):
                if re.match(r"^\d{4}-\d{2}-\d{2}", line):
                    if self.buf:
                        entry = parse_line("\n".join(self.buf))
                        if entry: self._save(entry)
                    self.buf = [line.rstrip()]
                else:
                    if self.buf: self.buf.append(line.rstrip())
        except Exception as e: print(f"[tail] {e}")

    def _save(self, entry):
        db = SessionLocal()
        try:
            db.add(entry); db.commit(); db.refresh(entry); _fire(entry)
        except Exception as e:
            logger.error("Failed to save live entry: %s", e)
            db.rollback()
        finally:
            db.close()

_tail_handlers: dict = {}

class LogFileHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith(".log"):
            time.sleep(1); ingest_file(event.src_path)
            _tail_handlers[event.src_path] = TailHandler(event.src_path)
    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith(".log"):
            if event.src_path in _tail_handlers:
                _tail_handlers[event.src_path].check()

def start_watcher(logs_path: str):
    for f in glob.glob(os.path.join(logs_path, "*.log")):
        _tail_handlers[f] = TailHandler(f)
    observer = Observer()
    observer.schedule(LogFileHandler(), logs_path, recursive=False)
    observer.start()
    print(f"[parser] Watching {logs_path}")
    return observer
