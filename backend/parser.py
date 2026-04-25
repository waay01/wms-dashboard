import re
import os
import time
import glob
import threading
from datetime import datetime
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from database import SessionLocal, LogEntry

LEVEL_MAP = {
    "ОШИБКА": "ERROR",
    "СООБЩЕНИЕ": "INFO",
    "ПОДРОБНОСТИ": "DEBUG",
    "КОНТЕКСТ": "DEBUG",
    "ОПЕРАТОР": "DEBUG",
    "ЗАМЕЧАНИЕ": "WARN",
    "ЗАПРОС": "DEBUG",
    "ОТЛАДКА": "DEBUG",
}

LOG_PATTERN = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+) MSK \[(\d+)\] (\S+)@(\S+) ([^:]+):\s+(.*)",
    re.DOTALL,
)

OPERATOR_PATTERN = re.compile(r"TEXT\t([^\tM][^\t]*?)(?=METHOD|$)")
TSD_MARKERS = ["XCOOR", "YCOOR", "PRINTMODE", "METHOD\tPRINT"]

broadcast_callbacks = []


def add_broadcast_callback(cb):
    broadcast_callbacks.append(cb)


def parse_line(raw: str):
    raw = raw.strip()
    if not raw:
        return None
    m = LOG_PATTERN.match(raw)
    if not m:
        return None

    ts_str, pid, db_user, database, level, msg = m.groups()
    level = level.strip()
    level_eng = LEVEL_MAP.get(level, "UNKNOWN")

    is_tsd = any(marker in msg for marker in TSD_MARKERS)
    operator_name = None
    if is_tsd:
        names = OPERATOR_PATTERN.findall(msg)
        # Фильтруем мусор — берём первое человекочитаемое имя
        for name in names:
            name = name.strip()
            if len(name) > 2 and not any(c in name for c in ["$", "=", "'"]):
                operator_name = name
                break

    try:
        timestamp = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S.%f")
    except ValueError:
        return None

    return LogEntry(
        timestamp=timestamp,
        pid=int(pid),
        db_user=db_user,
        database=database,
        level=level,
        level_eng=level_eng,
        msg=msg[:2000],
        is_tsd=1 if is_tsd else 0,
        operator_name=operator_name,
        raw=raw[:3000],
    )


def ingest_file(filepath: str):
    """Читает файл целиком и заливает в БД батчами."""
    db = SessionLocal()
    batch = []
    multiline_buf = []

    print(f"[parser] Ingesting {filepath}")
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if re.match(r"^\d{4}-\d{2}-\d{2}", line):
                    if multiline_buf:
                        entry = parse_line("\n".join(multiline_buf))
                        if entry:
                            batch.append(entry)
                    multiline_buf = [line.rstrip()]
                else:
                    if multiline_buf:
                        multiline_buf.append(line.rstrip())

            if multiline_buf:
                entry = parse_line("\n".join(multiline_buf))
                if entry:
                    batch.append(entry)

        if batch:
            db.bulk_save_objects(batch)
            db.commit()
            print(f"[parser] Saved {len(batch)} entries from {os.path.basename(filepath)}")
    except Exception as e:
        print(f"[parser] Error ingesting {filepath}: {e}")
        db.rollback()
    finally:
        db.close()


def ingest_all(logs_path: str):
    """Заливает все существующие лог-файлы."""
    files = sorted(glob.glob(os.path.join(logs_path, "*.log")))
    for f in files:
        ingest_file(f)


class LogFileHandler(FileSystemEventHandler):
    """Следит за новыми файлами и изменениями."""

    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith(".log"):
            time.sleep(1)
            ingest_file(event.src_path)

    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith(".log"):
            pass  # tail логика при необходимости


def start_watcher(logs_path: str):
    observer = Observer()
    handler = LogFileHandler()
    observer.schedule(handler, logs_path, recursive=False)
    observer.start()
    print(f"[parser] Watching {logs_path} for new log files")
    return observer
