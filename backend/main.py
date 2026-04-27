import os, io, csv, threading, asyncio, logging
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, text as sa_text
from database import init_db, get_db, LogEntry
from parser import ingest_all, start_watcher, set_ws_broadcast
import uvicorn

logger = logging.getLogger(__name__)

LOGS_PATH = os.getenv("LOGS_PATH", "./logs")
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

VALID_INTERVALS = {"minute", "hour", "day", "week", "month"}

class ConnectionManager:
    def __init__(self): self.active = []
    async def connect(self, ws): await ws.accept(); self.active.append(ws)
    def disconnect(self, ws):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, data):
        for ws in self.active.copy():
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(ws)

manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    set_ws_broadcast(manager.broadcast)
    def _ingest(): ingest_all(LOGS_PATH); start_watcher(LOGS_PATH)
    threading.Thread(target=_ingest, daemon=True).start()
    yield

app = FastAPI(title="WMS Log Dashboard", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def _build_where(date_from, date_to, extra_conditions="", params=None):
    """Build parameterized WHERE clause from date filters."""
    if params is None:
        params = {}
    clauses = ["1=1"]
    if extra_conditions:
        clauses.append(extra_conditions)
    df = parse_dt(date_from)
    dt = parse_dt(date_to, end_of_day=True)
    if df:
        params["_df"] = df
        clauses.append("timestamp >= :_df")
    if dt:
        params["_dt"] = dt
        clauses.append("timestamp <= :_dt")
    return "WHERE " + " AND ".join(clauses), params


def parse_dt(s, end_of_day=False):
    if not s: return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        dt = datetime.strptime(s, "%Y-%m-%d")
        return dt.replace(hour=23, minute=59, second=59) if end_of_day else dt
    except ValueError:
        return None

def apply_time_filter(q, date_from, date_to):
    df = parse_dt(date_from)
    dt = parse_dt(date_to, end_of_day=True)
    if df: q = q.filter(LogEntry.timestamp >= df)
    if dt: q = q.filter(LogEntry.timestamp <= dt)
    return q

@app.get("/api/stats")
def get_stats(date_from=None, date_to=None, db: Session = Depends(get_db)):
    q = apply_time_filter(db.query(LogEntry), date_from, date_to)
    since = datetime.utcnow() - timedelta(hours=24)
    return {
        "total": q.count(),
        "errors": q.filter(LogEntry.level_eng == "ERROR").count(),
        "warnings": q.filter(LogEntry.level_eng == "WARN").count(),
        "tsd_events": q.filter(LogEntry.is_tsd == 1).count(),
        "integration_errors": q.filter(LogEntry.database == "leadwms_transit", LogEntry.level_eng == "ERROR").count(),
        "errors_24h": db.query(func.count(LogEntry.id)).filter(LogEntry.level_eng == "ERROR", LogEntry.timestamp >= since).scalar(),
    }

@app.get("/api/logs")
def get_logs(level=None, database=None, search=None, is_tsd: Optional[bool]=None, date_from=None, date_to=None, limit: int=Query(100, le=1000), offset: int=0, db: Session=Depends(get_db)):
    q = db.query(LogEntry)
    if level: q = q.filter(LogEntry.level_eng == level.upper())
    if database: q = q.filter(LogEntry.database == database)
    if search: q = q.filter(LogEntry.msg.ilike(f"%{search}%"))
    if is_tsd is not None: q = q.filter(LogEntry.is_tsd == (1 if is_tsd else 0))
    q = apply_time_filter(q, date_from, date_to)
    total = q.count()
    items = q.order_by(LogEntry.timestamp.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [{"id": e.id, "timestamp": e.timestamp.isoformat(), "pid": e.pid, "database": e.database, "level": e.level, "level_eng": e.level_eng, "msg": e.msg, "is_tsd": bool(e.is_tsd), "operator_name": e.operator_name, "terminal_uuid": e.terminal_uuid} for e in items]}

@app.get("/api/logs/export")
def export_logs(level=None, database=None, search=None, date_from=None, date_to=None, db: Session=Depends(get_db)):
    q = db.query(LogEntry)
    if level: q = q.filter(LogEntry.level_eng == level.upper())
    if database: q = q.filter(LogEntry.database == database)
    if search: q = q.filter(LogEntry.msg.ilike(f"%{search}%"))
    q = apply_time_filter(q, date_from, date_to)
    items = q.order_by(LogEntry.timestamp.desc()).limit(10000).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["timestamp","level","database","operator","msg"])
    for e in items: writer.writerow([e.timestamp.isoformat(), e.level_eng, e.database, e.operator_name or "", e.msg or ""])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=wms_logs.csv"})

@app.get("/api/integration-errors")
def get_integration_errors(date_from=None, date_to=None, search=None, limit: int=Query(100, le=1000), offset: int=0, db: Session=Depends(get_db)):
    q = db.query(LogEntry).filter(LogEntry.database == "leadwms_transit", LogEntry.level_eng == "ERROR")
    if search: q = q.filter(LogEntry.msg.ilike(f"%{search}%"))
    q = apply_time_filter(q, date_from, date_to)
    total = q.count()
    items = q.order_by(LogEntry.timestamp.desc()).offset(offset).limit(limit).all()
    return {"total": total, "items": [{"id": e.id, "timestamp": e.timestamp.isoformat(), "msg": e.msg, "pid": e.pid} for e in items]}

@app.get("/api/integration-errors/summary")
def integration_summary(date_from=None, date_to=None, db: Session=Depends(get_db)):
    where, params = _build_where(date_from, date_to, "database = 'leadwms_transit' AND level_eng = 'ERROR'")
    rows = db.execute(sa_text(f"SELECT SUBSTRING(msg,1,100) as m, COUNT(*) as c, MIN(timestamp) as f, MAX(timestamp) as l FROM log_entries {where} GROUP BY m ORDER BY c DESC LIMIT 20"), params).fetchall()
    return [{"msg": r[0], "count": r[1], "first_seen": r[2].isoformat() if r[2] else None, "last_seen": r[3].isoformat() if r[3] else None} for r in rows]

@app.get("/api/operators")
def get_operators(date_from=None, date_to=None, db: Session=Depends(get_db)):
    where, params = _build_where(date_from, date_to, "is_tsd = 1 AND operator_name IS NOT NULL AND operator_name != ''")
    rows = db.execute(sa_text(f"SELECT operator_name, COUNT(*) as t, SUM(CASE WHEN level_eng='ERROR' THEN 1 ELSE 0 END) as e FROM log_entries {where} GROUP BY operator_name ORDER BY t DESC LIMIT 20"), params).fetchall()
    return [{"operator": r[0], "operations": r[1], "errors": r[2]} for r in rows]

@app.get("/api/watchdog")
def get_watchdog(db: Session=Depends(get_db)):
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    one_day_ago = datetime.utcnow() - timedelta(days=1)
    rows = db.execute(sa_text("""
        WITH recent AS (SELECT SUBSTRING(msg,1,120) as m, COUNT(*) as c FROM log_entries WHERE level_eng='ERROR' AND timestamp>=:h GROUP BY m),
        historical AS (SELECT SUBSTRING(msg,1,120) as m FROM log_entries WHERE level_eng='ERROR' AND timestamp<:h AND timestamp>=:d GROUP BY m)
        SELECT r.m, r.c FROM recent r LEFT JOIN historical h ON r.m=h.m WHERE h.m IS NULL ORDER BY r.c DESC LIMIT 10
    """), {"h": one_hour_ago, "d": one_day_ago}).fetchall()
    return [{"msg": r[0], "count": r[1]} for r in rows]

@app.get("/api/charts/activity")
def chart_activity(interval: str="hour", date_from=None, date_to=None, db: Session=Depends(get_db)):
    if interval not in VALID_INTERVALS:
        raise HTTPException(400, f"interval must be one of: {', '.join(sorted(VALID_INTERVALS))}")
    where, params = _build_where(date_from, date_to)
    rows = db.execute(sa_text(f"SELECT date_trunc('{interval}', timestamp) as t, level_eng, COUNT(*) as c FROM log_entries {where} GROUP BY t, level_eng ORDER BY t"), params).fetchall()
    result = {}
    for r in rows:
        t = r[0].isoformat() if r[0] else None
        if t not in result: result[t] = {"time": t}
        result[t][r[1]] = r[2]
    return list(result.values())

@app.get("/api/charts/databases")
def chart_databases(date_from=None, date_to=None, db: Session=Depends(get_db)):
    q = apply_time_filter(db.query(LogEntry.database, func.count(LogEntry.id)), date_from, date_to)
    return [{"database": r[0], "count": r[1]} for r in q.group_by(LogEntry.database).order_by(func.count(LogEntry.id).desc()).all()]

@app.get("/api/charts/top-errors")
def chart_top_errors(limit: int=Query(10, le=100), date_from=None, date_to=None, db: Session=Depends(get_db)):
    where, params = _build_where(date_from, date_to, "level_eng = 'ERROR'")
    params["_limit"] = limit
    rows = db.execute(sa_text(f"SELECT SUBSTRING(msg,1,80) as m, COUNT(*) as c FROM log_entries {where} GROUP BY m ORDER BY c DESC LIMIT :_limit"), params).fetchall()
    return [{"msg": r[0], "count": r[1]} for r in rows]

@app.get("/api/charts/levels")
def chart_levels(date_from=None, date_to=None, db: Session=Depends(get_db)):
    q = apply_time_filter(db.query(LogEntry.level_eng, func.count(LogEntry.id)), date_from, date_to)
    return [{"level": r[0], "count": r[1]} for r in q.group_by(LogEntry.level_eng).order_by(func.count(LogEntry.id).desc()).all()]

@app.get("/api/filters/databases")
def filter_databases(db: Session=Depends(get_db)):
    return [r[0] for r in db.query(LogEntry.database).distinct().all() if r[0]]

@app.get("/api/filters/date-range")
def filter_date_range(db: Session=Depends(get_db)):
    row = db.execute(sa_text("SELECT MIN(timestamp), MAX(timestamp) FROM log_entries")).fetchone()
    return {"min": row[0].isoformat() if row[0] else None, "max": row[1].isoformat() if row[1] else None}

@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True: await asyncio.sleep(10)
    except WebSocketDisconnect: manager.disconnect(ws)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)



@app.post("/api/admin/rescan")
def rescan(db: Session = Depends(get_db)):
    """Сканирует папку логов и загружает только новые файлы."""
    from parser import rescan_new
    results = []
    error = None
    def _run():
        nonlocal results, error
        try:
            results = rescan_new(LOGS_PATH)
        except Exception as e:
            error = str(e)
    t = threading.Thread(target=_run)
    t.start()
    t.join(timeout=30)
    if t.is_alive():
        return {"status": "running", "msg": "Rescan is still in progress", "new_files": []}
    if error:
        raise HTTPException(500, detail=f"Rescan failed: {error}")
    return {"status": "ok", "new_files": results}

@app.get("/api/admin/files")
def list_files(db: Session = Depends(get_db)):
    """Список всех загруженных файлов."""
    from database import IngestedFile
    rows = db.query(IngestedFile).order_by(IngestedFile.filename).all()
    all_files = __import__('glob').glob(os.path.join(LOGS_PATH, "*.log"))
    ingested = {r.filename: r.entry_count for r in rows}
    result = []
    for f in sorted(all_files):
        name = os.path.basename(f)
        result.append({"file": name, "ingested": name in ingested, "entries": ingested.get(name, 0)})
    return result


@app.get("/api/compare")
def compare_periods(
    date_from_a: str, date_to_a: str,
    date_from_b: str, date_to_b: str,
    db: Session = Depends(get_db)
):
    """Сравнение двух периодов по всем метрикам."""
    def get_metrics(df_str, dt_str, prefix=""):
        where, params = _build_where(df_str, dt_str)
        p = {f"{prefix}{k}": v for k, v in params.items()}
        w = where
        for k in params:
            w = w.replace(f":{k}", f":{prefix}{k}")

        row = db.execute(sa_text(f"""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN level_eng='ERROR' THEN 1 ELSE 0 END) as errors,
                SUM(CASE WHEN level_eng='WARN' THEN 1 ELSE 0 END) as warnings,
                SUM(CASE WHEN is_tsd=1 THEN 1 ELSE 0 END) as tsd,
                SUM(CASE WHEN database='leadwms_transit' AND level_eng='ERROR' THEN 1 ELSE 0 END) as integration,
                COUNT(DISTINCT database) as databases,
                COUNT(DISTINCT operator_name) FILTER (WHERE operator_name IS NOT NULL) as operators
            FROM log_entries {w}
        """), p).fetchone()

        top_errors = db.execute(sa_text(f"""
            SELECT SUBSTRING(msg,1,60) as m, COUNT(*) as c
            FROM log_entries {w} AND level_eng='ERROR'
            GROUP BY m ORDER BY c DESC LIMIT 5
        """), p).fetchall()

        by_level = db.execute(sa_text(f"""
            SELECT level_eng, COUNT(*) as c
            FROM log_entries {w}
            GROUP BY level_eng ORDER BY c DESC
        """), p).fetchall()

        return {
            "total": row[0] or 0,
            "errors": row[1] or 0,
            "warnings": row[2] or 0,
            "tsd": row[3] or 0,
            "integration": row[4] or 0,
            "databases": row[5] or 0,
            "operators": row[6] or 0,
            "top_errors": [{"msg": r[0], "count": r[1]} for r in top_errors],
            "by_level": [{"level": r[0], "count": r[1]} for r in by_level],
        }

    return {
        "period_a": {"from": date_from_a, "to": date_to_a, **get_metrics(date_from_a, date_to_a, "a_")},
        "period_b": {"from": date_from_b, "to": date_to_b, **get_metrics(date_from_b, date_to_b, "b_")},
    }


@app.get("/api/sessions/operators")
def session_operators(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Список операторов у которых есть TSD сессии."""
    where, params = _build_where(date_from, date_to, "is_tsd = 1 AND terminal_uuid IS NOT NULL")
    rows = db.execute(sa_text(f"""
        SELECT 
            COALESCE(operator_name, '—') as operator,
            terminal_uuid,
            COUNT(*) as events,
            SUM(CASE WHEN level_eng='ERROR' THEN 1 ELSE 0 END) as errors,
            MIN(timestamp) as first_seen,
            MAX(timestamp) as last_seen
        FROM log_entries {where}
        GROUP BY operator_name, terminal_uuid
        ORDER BY last_seen DESC
        LIMIT 100
    """), params).fetchall()
    return [
        {
            "operator": r[0],
            "terminal_uuid": r[1],
            "events": r[2],
            "errors": r[3],
            "first_seen": r[4].isoformat() if r[4] else None,
            "last_seen": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


@app.get("/api/sessions/timeline")
def session_timeline(
    terminal_uuid: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Хронология экранов ТСД и ошибок для конкретного терминала."""
    where, params = _build_where(date_from, date_to, "terminal_uuid = :uuid")
    params["uuid"] = terminal_uuid

    rows = db.execute(sa_text(f"""
        SELECT 
            timestamp, level_eng, msg, operator_name, database
        FROM log_entries
        {where}
        ORDER BY timestamp ASC
        LIMIT 500
    """), params).fetchall()

    SEP = chr(11)
    TAB = chr(9)
    TSD_TEXT_PREFIX = 'TEXT' + TAB

    events = []
    for row in rows:
        ts, level, msg, operator, database = row
        
        # Извлекаем тексты экрана ТСД
        screen_texts = []
        if msg and SEP in msg:
            parts = msg.split(SEP)
            for part in parts:
                p = part.strip()
                if p.startswith(TSD_TEXT_PREFIX):
                    tsd_text = p[len(TSD_TEXT_PREFIX):].strip()
                    if tsd_text and not tsd_text.upper() == tsd_text:
                        screen_texts.append(tsd_text)

        events.append({
            "timestamp": ts.isoformat(),
            "level_eng": level,
            "operator": operator,
            "database": database,
            "screen_texts": screen_texts[:5],
            "msg_short": (msg or "")[:150],
            "is_error": level == "ERROR",
        })

    return events
