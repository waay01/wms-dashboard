import os
import threading
import asyncio
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from database import init_db, get_db, LogEntry
from parser import ingest_all, start_watcher
import uvicorn

app = FastAPI(title="WMS Log Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

LOGS_PATH = os.getenv("LOGS_PATH", "./logs")

# WebSocket менеджер
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        self.active.remove(ws)

    async def broadcast(self, data: dict):
        for ws in self.active.copy():
            try:
                await ws.send_json(data)
            except Exception:
                self.active.remove(ws)

manager = ConnectionManager()


@app.on_event("startup")
async def startup():
    init_db()
    # Заливаем существующие логи в отдельном потоке
    def _ingest():
        ingest_all(LOGS_PATH)
        start_watcher(LOGS_PATH)

    threading.Thread(target=_ingest, daemon=True).start()


# ─── STATS ────────────────────────────────────────────────────────────────────

@app.get("/api/stats")
def get_stats(db: Session = Depends(get_db)):
    total = db.query(func.count(LogEntry.id)).scalar()
    errors = db.query(func.count(LogEntry.id)).filter(LogEntry.level_eng == "ERROR").scalar()
    warnings = db.query(func.count(LogEntry.id)).filter(LogEntry.level_eng == "WARN").scalar()
    tsd = db.query(func.count(LogEntry.id)).filter(LogEntry.is_tsd == 1).scalar()

    # За последние 24ч
    since = datetime.utcnow() - timedelta(hours=24)
    errors_24h = db.query(func.count(LogEntry.id)).filter(
        LogEntry.level_eng == "ERROR",
        LogEntry.timestamp >= since
    ).scalar()

    return {
        "total": total,
        "errors": errors,
        "warnings": warnings,
        "tsd_events": tsd,
        "errors_24h": errors_24h,
    }


# ─── LOGS ─────────────────────────────────────────────────────────────────────

@app.get("/api/logs")
def get_logs(
    level: Optional[str] = None,
    database: Optional[str] = None,
    search: Optional[str] = None,
    is_tsd: Optional[bool] = None,
    limit: int = Query(default=100, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    q = db.query(LogEntry)
    if level:
        q = q.filter(LogEntry.level_eng == level.upper())
    if database:
        q = q.filter(LogEntry.database == database)
    if search:
        q = q.filter(LogEntry.msg.ilike(f"%{search}%"))
    if is_tsd is not None:
        q = q.filter(LogEntry.is_tsd == (1 if is_tsd else 0))

    total = q.count()
    items = q.order_by(LogEntry.timestamp.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "items": [
            {
                "id": e.id,
                "timestamp": e.timestamp.isoformat(),
                "pid": e.pid,
                "database": e.database,
                "level": e.level,
                "level_eng": e.level_eng,
                "msg": e.msg,
                "is_tsd": bool(e.is_tsd),
                "operator_name": e.operator_name,
            }
            for e in items
        ],
    }


# ─── CHARTS ───────────────────────────────────────────────────────────────────

@app.get("/api/charts/activity")
def chart_activity(
    interval: str = "hour",
    db: Session = Depends(get_db),
):
    """Активность по времени сгруппированная по уровням."""
    trunc = f"date_trunc('{interval}', timestamp)"
    rows = db.execute(text(f"""
        SELECT {trunc} as t, level_eng, COUNT(*) as cnt
        FROM log_entries
        GROUP BY t, level_eng
        ORDER BY t
    """)).fetchall()

    result = {}
    for row in rows:
        t = row[0].isoformat() if row[0] else None
        level = row[1]
        cnt = row[2]
        if t not in result:
            result[t] = {"time": t}
        result[t][level] = cnt

    return list(result.values())


@app.get("/api/charts/databases")
def chart_databases(db: Session = Depends(get_db)):
    rows = db.query(LogEntry.database, func.count(LogEntry.id))\
        .group_by(LogEntry.database)\
        .order_by(func.count(LogEntry.id).desc())\
        .all()
    return [{"database": r[0], "count": r[1]} for r in rows]


@app.get("/api/charts/top-errors")
def chart_top_errors(limit: int = 10, db: Session = Depends(get_db)):
    rows = db.execute(text(f"""
        SELECT SUBSTRING(msg, 1, 80) as short_msg, COUNT(*) as cnt
        FROM log_entries
        WHERE level_eng = 'ERROR'
        GROUP BY short_msg
        ORDER BY cnt DESC
        LIMIT {limit}
    """)).fetchall()
    return [{"msg": r[0], "count": r[1]} for r in rows]


@app.get("/api/charts/levels")
def chart_levels(db: Session = Depends(get_db)):
    rows = db.query(LogEntry.level_eng, func.count(LogEntry.id))\
        .group_by(LogEntry.level_eng)\
        .order_by(func.count(LogEntry.id).desc())\
        .all()
    return [{"level": r[0], "count": r[1]} for r in rows]


# ─── FILTERS ──────────────────────────────────────────────────────────────────

@app.get("/api/filters/databases")
def filter_databases(db: Session = Depends(get_db)):
    rows = db.query(LogEntry.database).distinct().all()
    return [r[0] for r in rows if r[0]]


@app.get("/api/filters/levels")
def filter_levels(db: Session = Depends(get_db)):
    rows = db.query(LogEntry.level_eng).distinct().all()
    return [r[0] for r in rows if r[0]]


# ─── WEBSOCKET ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await asyncio.sleep(30)
    except WebSocketDisconnect:
        manager.disconnect(ws)


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
