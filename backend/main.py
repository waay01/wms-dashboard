import os, io, csv, threading, asyncio
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from database import init_db, get_db, LogEntry
from parser import ingest_all, start_watcher, set_ws_broadcast
import uvicorn

app = FastAPI(title="WMS Log Dashboard")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
LOGS_PATH = os.getenv("LOGS_PATH", "./logs")

class ConnectionManager:
    def __init__(self): self.active = []
    async def connect(self, ws): await ws.accept(); self.active.append(ws)
    def disconnect(self, ws):
        if ws in self.active: self.active.remove(ws)
    async def broadcast(self, data):
        for ws in self.active.copy():
            try: await ws.send_json(data)
            except: self.disconnect(ws)

manager = ConnectionManager()

@app.on_event("startup")
async def startup():
    init_db()
    set_ws_broadcast(manager.broadcast)
    def _ingest(): ingest_all(LOGS_PATH); start_watcher(LOGS_PATH)
    threading.Thread(target=_ingest, daemon=True).start()

def parse_dt(s, end_of_day=False):
    if not s: return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try: return datetime.strptime(s, fmt)
        except: continue
    try:
        dt = datetime.strptime(s, "%Y-%m-%d")
        return dt.replace(hour=23, minute=59, second=59) if end_of_day else dt
    except: return None

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
    return {"total": total, "items": [{"id": e.id, "timestamp": e.timestamp.isoformat(), "pid": e.pid, "database": e.database, "level": e.level, "level_eng": e.level_eng, "msg": e.msg, "is_tsd": bool(e.is_tsd), "operator_name": e.operator_name} for e in items]}

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
    df = parse_dt(date_from); dt = parse_dt(date_to, end_of_day=True)
    where = "WHERE database = 'leadwms_transit' AND level_eng = 'ERROR'"
    if df: where += f" AND timestamp >= '{df.isoformat()}'"
    if dt: where += f" AND timestamp <= '{dt.isoformat()}'"
    rows = db.execute(text(f"SELECT SUBSTRING(msg,1,100) as m, COUNT(*) as c, MIN(timestamp) as f, MAX(timestamp) as l FROM log_entries {where} GROUP BY m ORDER BY c DESC LIMIT 20")).fetchall()
    return [{"msg": r[0], "count": r[1], "first_seen": r[2].isoformat() if r[2] else None, "last_seen": r[3].isoformat() if r[3] else None} for r in rows]

@app.get("/api/operators")
def get_operators(date_from=None, date_to=None, db: Session=Depends(get_db)):
    df = parse_dt(date_from); dt = parse_dt(date_to, end_of_day=True)
    where = "WHERE is_tsd = 1 AND operator_name IS NOT NULL AND operator_name != ''"
    if df: where += f" AND timestamp >= '{df.isoformat()}'"
    if dt: where += f" AND timestamp <= '{dt.isoformat()}'"
    rows = db.execute(text(f"SELECT operator_name, COUNT(*) as t, SUM(CASE WHEN level_eng='ERROR' THEN 1 ELSE 0 END) as e FROM log_entries {where} GROUP BY operator_name ORDER BY t DESC LIMIT 20")).fetchall()
    return [{"operator": r[0], "operations": r[1], "errors": r[2]} for r in rows]

@app.get("/api/watchdog")
def get_watchdog(db: Session=Depends(get_db)):
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    one_day_ago = datetime.utcnow() - timedelta(days=1)
    rows = db.execute(text("""
        WITH recent AS (SELECT SUBSTRING(msg,1,120) as m, COUNT(*) as c FROM log_entries WHERE level_eng='ERROR' AND timestamp>=:h GROUP BY m),
        historical AS (SELECT SUBSTRING(msg,1,120) as m FROM log_entries WHERE level_eng='ERROR' AND timestamp<:h AND timestamp>=:d GROUP BY m)
        SELECT r.m, r.c FROM recent r LEFT JOIN historical h ON r.m=h.m WHERE h.m IS NULL ORDER BY r.c DESC LIMIT 10
    """), {"h": one_hour_ago, "d": one_day_ago}).fetchall()
    return [{"msg": r[0], "count": r[1]} for r in rows]

@app.get("/api/charts/activity")
def chart_activity(interval: str="hour", date_from=None, date_to=None, db: Session=Depends(get_db)):
    df = parse_dt(date_from); dt = parse_dt(date_to, end_of_day=True)
    where = ""
    if df: where += f" AND timestamp >= '{df.isoformat()}'"
    if dt: where += f" AND timestamp <= '{dt.isoformat()}'"
    rows = db.execute(text(f"SELECT date_trunc('{interval}', timestamp) as t, level_eng, COUNT(*) as c FROM log_entries WHERE 1=1 {where} GROUP BY t, level_eng ORDER BY t")).fetchall()
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
def chart_top_errors(limit: int=10, date_from=None, date_to=None, db: Session=Depends(get_db)):
    df = parse_dt(date_from); dt = parse_dt(date_to, end_of_day=True)
    where = "WHERE level_eng = 'ERROR'"
    if df: where += f" AND timestamp >= '{df.isoformat()}'"
    if dt: where += f" AND timestamp <= '{dt.isoformat()}'"
    rows = db.execute(text(f"SELECT SUBSTRING(msg,1,80) as m, COUNT(*) as c FROM log_entries {where} GROUP BY m ORDER BY c DESC LIMIT {limit}")).fetchall()
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
    row = db.execute(text("SELECT MIN(timestamp), MAX(timestamp) FROM log_entries")).fetchone()
    return {"min": row[0].isoformat() if row[0] else None, "max": row[1].isoformat() if row[1] else None}

@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True: await asyncio.sleep(10)
    except WebSocketDisconnect: manager.disconnect(ws)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
