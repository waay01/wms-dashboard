#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "Applying WMS Dashboard v2..."

# ── BACKEND ──────────────────────────────────────────────────────────────────

cat > backend/main.py << 'EOF'
import os
import io
import csv
import threading
import asyncio
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from database import init_db, get_db, LogEntry
from parser import ingest_all, start_watcher
import uvicorn

app = FastAPI(title="WMS Log Dashboard")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
LOGS_PATH = os.getenv("LOGS_PATH", "./logs")

class ConnectionManager:
    def __init__(self): self.active = []
    async def connect(self, ws):
        await ws.accept(); self.active.append(ws)
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
    def _ingest(): ingest_all(LOGS_PATH); start_watcher(LOGS_PATH)
    threading.Thread(target=_ingest, daemon=True).start()

def parse_dt(s):
    if not s: return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try: return datetime.strptime(s, fmt)
        except: continue
    return None

def apply_time_filter(q, date_from, date_to):
    df = parse_dt(date_from); dt = parse_dt(date_to)
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
    df = parse_dt(date_from); dt = parse_dt(date_to)
    where = "WHERE database = 'leadwms_transit' AND level_eng = 'ERROR'"
    if df: where += f" AND timestamp >= '{df.isoformat()}'"
    if dt: where += f" AND timestamp <= '{dt.isoformat()}'"
    rows = db.execute(text(f"SELECT SUBSTRING(msg,1,100) as m, COUNT(*) as c, MIN(timestamp) as f, MAX(timestamp) as l FROM log_entries {where} GROUP BY m ORDER BY c DESC LIMIT 20")).fetchall()
    return [{"msg": r[0], "count": r[1], "first_seen": r[2].isoformat() if r[2] else None, "last_seen": r[3].isoformat() if r[3] else None} for r in rows]

@app.get("/api/operators")
def get_operators(date_from=None, date_to=None, db: Session=Depends(get_db)):
    df = parse_dt(date_from); dt = parse_dt(date_to)
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
    df = parse_dt(date_from); dt = parse_dt(date_to)
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
    df = parse_dt(date_from); dt = parse_dt(date_to)
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

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True: await asyncio.sleep(30)
    except WebSocketDisconnect: manager.disconnect(ws)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
EOF

# ── FRONTEND FILES ────────────────────────────────────────────────────────────

mkdir -p frontend/src/api frontend/src/components

cat > frontend/src/api/client.ts << 'EOF'
const BASE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : `http://${window.location.hostname}:8000`
export { BASE }
function qs(p: Record<string, any>) {
  const q = new URLSearchParams()
  Object.entries(p).forEach(([k,v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
  return q.toString() ? `?${q}` : ''
}
export async function fetchStats(p={}) { return (await fetch(`${BASE}/api/stats${qs(p)}`)).json() }
export async function fetchLogs(p: Record<string,any>={}) { return (await fetch(`${BASE}/api/logs${qs(p)}`)).json() }
export async function fetchActivityChart(p: Record<string,any>={}) { return (await fetch(`${BASE}/api/charts/activity${qs(p)}`)).json() }
export async function fetchDatabasesChart(p={}) { return (await fetch(`${BASE}/api/charts/databases${qs(p)}`)).json() }
export async function fetchTopErrors(p: Record<string,any>={}) { return (await fetch(`${BASE}/api/charts/top-errors${qs(p)}`)).json() }
export async function fetchFilterDatabases() { return (await fetch(`${BASE}/api/filters/databases`)).json() }
export async function fetchDateRange() { return (await fetch(`${BASE}/api/filters/date-range`)).json() }
export async function fetchIntegrationErrors(p: Record<string,any>={}) { return (await fetch(`${BASE}/api/integration-errors${qs(p)}`)).json() }
export async function fetchIntegrationSummary(p={}) { return (await fetch(`${BASE}/api/integration-errors/summary${qs(p)}`)).json() }
export async function fetchOperators(p={}) { return (await fetch(`${BASE}/api/operators${qs(p)}`)).json() }
export async function fetchWatchdog() { return (await fetch(`${BASE}/api/watchdog`)).json() }
export function exportUrl(p: Record<string,any>={}) { return `${BASE}/api/logs/export${qs(p)}` }
EOF

cat > frontend/src/api/useUrlFilters.ts << 'EOF'
import { useState, useCallback } from 'react'
export interface Filters { dateFrom: string; dateTo: string; level: string; database: string; search: string }
const DEFAULT: Filters = { dateFrom: '', dateTo: '', level: '', database: '', search: '' }
function toUrl(f: Filters) { const p = new URLSearchParams(); Object.entries(f).forEach(([k,v]) => { if (v) p.set(k,v) }); return p }
function fromUrl(): Filters { const p = new URLSearchParams(window.location.search); return { dateFrom: p.get('dateFrom')||'', dateTo: p.get('dateTo')||'', level: p.get('level')||'', database: p.get('database')||'', search: p.get('search')||'' } }
export function useUrlFilters() {
  const [filters, setFiltersState] = useState<Filters>(fromUrl)
  const setFilters = useCallback((f: Filters | ((p: Filters) => Filters)) => {
    setFiltersState(prev => {
      const next = typeof f === 'function' ? f(prev) : f
      const params = toUrl(next)
      window.history.replaceState(null, '', params.toString() ? `?${params}` : window.location.pathname)
      return next
    })
  }, [])
  return { filters, setFilters, reset: useCallback(() => setFilters(DEFAULT), []) }
}
EOF

cat > frontend/src/components/Toast.tsx << 'EOF'
import { useState, useCallback, createContext, useContext } from 'react'
import { AlertTriangle, X, CheckCircle, Info } from 'lucide-react'
import clsx from 'clsx'
type ToastType = 'error'|'warn'|'info'|'success'
interface Toast { id: number; type: ToastType; title: string; msg?: string }
interface ToastCtx { push: (t: Omit<Toast,'id'>) => void }
const Ctx = createContext<ToastCtx>({ push: () => {} })
export function useToast() { return useContext(Ctx) }
const ICONS = { error: AlertTriangle, warn: AlertTriangle, info: Info, success: CheckCircle }
const STYLES = { error: 'border-red-500/40 bg-red-950/80', warn: 'border-orange-500/40 bg-orange-950/80', info: 'border-blue-500/40 bg-blue-950/80', success: 'border-emerald-500/40 bg-emerald-950/80' }
const ICON_STYLES = { error: 'text-red-400', warn: 'text-orange-400', info: 'text-blue-400', success: 'text-emerald-400' }
let _id = 0
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((t: Omit<Toast,'id'>) => {
    const id = ++_id
    setToasts(p => [...p, {...t, id}])
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 5000)
  }, [])
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map(t => { const Icon = ICONS[t.type]; return (
          <div key={t.id} className={clsx('flex items-start gap-3 rounded-xl border px-4 py-3 backdrop-blur-sm shadow-xl animate-in', STYLES[t.type])}>
            <Icon size={16} className={clsx('mt-0.5 shrink-0', ICON_STYLES[t.type])} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-100">{t.title}</p>
              {t.msg && <p className="text-xs text-slate-400 mono mt-0.5 truncate">{t.msg}</p>}
            </div>
            <button onClick={() => setToasts(p => p.filter(x => x.id !== t.id))} className="text-slate-500 hover:text-slate-300"><X size={14}/></button>
          </div>
        )})}
      </div>
    </Ctx.Provider>
  )
}
EOF

cat > frontend/src/components/ThemeToggle.tsx << 'EOF'
import { Sun, Moon } from 'lucide-react'
export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors bg-slate-800/60 border-white/5 text-slate-400 hover:bg-slate-700 hover:text-slate-200">
      {dark ? <Sun size={13}/> : <Moon size={13}/>}
      {dark ? 'Светлая' : 'Тёмная'}
    </button>
  )
}
EOF

cat > frontend/src/components/DateRangePicker.tsx << 'EOF'
import { useState } from 'react'
import { Calendar, ChevronDown, X } from 'lucide-react'
import clsx from 'clsx'
interface Props { dateFrom: string; dateTo: string; onChange: (f: string, t: string) => void; minDate?: string; maxDate?: string }
const today = () => new Date().toISOString().slice(0,10)
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10) }
const PRESETS = [
  { label: 'Сегодня', fn: () => [today(), today()] },
  { label: 'Вчера', fn: () => [daysAgo(1), daysAgo(1)] },
  { label: '7 дней', fn: () => [daysAgo(6), today()] },
  { label: '30 дней', fn: () => [daysAgo(29), today()] },
  { label: 'Всё время', fn: () => ['', ''] },
]
export function DateRangePicker({ dateFrom, dateTo, onChange, minDate, maxDate }: Props) {
  const [open, setOpen] = useState(false)
  const hasValue = !!(dateFrom || dateTo)
  const label = hasValue ? `${dateFrom||'...'} → ${dateTo||'...'}` : 'Все даты'
  return (
    <div className="relative">
      <button onClick={() => setOpen(o=>!o)} className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors', hasValue ? 'bg-blue-500/20 border-blue-500/30 text-blue-300' : 'bg-slate-800/60 border-white/5 text-slate-300')}>
        <Calendar size={14}/>
        <span className="mono">{label}</span>
        {hasValue ? <X size={13} className="ml-1 opacity-60 hover:opacity-100" onClick={e=>{e.stopPropagation();onChange('','')}}/> : <ChevronDown size={13} className="opacity-60"/>}
      </button>
      {open && (
        <div className="absolute top-full mt-2 left-0 z-40 bg-slate-900 border border-white/10 rounded-xl shadow-2xl p-4 min-w-[280px]">
          <div className="flex flex-wrap gap-1.5 mb-4">
            {PRESETS.map(p => <button key={p.label} onClick={() => { const [f,t] = p.fn(); onChange(f,t); setOpen(false) }} className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/5">{p.label}</button>)}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-500 uppercase tracking-widest">Свой диапазон</label>
            <div className="flex gap-2 items-center">
              <input type="date" value={dateFrom} min={minDate?.slice(0,10)} max={dateTo||maxDate?.slice(0,10)} onChange={e=>onChange(e.target.value,dateTo)} className="flex-1 bg-slate-800 border border-white/5 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none focus:border-blue-500/50"/>
              <span className="text-slate-600 text-xs">→</span>
              <input type="date" value={dateTo} min={dateFrom||minDate?.slice(0,10)} max={maxDate?.slice(0,10)} onChange={e=>onChange(dateFrom,e.target.value)} className="flex-1 bg-slate-800 border border-white/5 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none focus:border-blue-500/50"/>
            </div>
            <button onClick={()=>setOpen(false)} className="mt-1 w-full py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white">Применить</button>
          </div>
        </div>
      )}
      {open && <div className="fixed inset-0 z-30" onClick={()=>setOpen(false)}/>}
    </div>
  )
}
EOF

cat > frontend/src/components/IntegrationErrors.tsx << 'EOF'
import { useState, useEffect } from 'react'
import { Zap } from 'lucide-react'
import { fetchIntegrationSummary, fetchIntegrationErrors } from '../api/client'
interface Props { dateFrom: string; dateTo: string }
interface Summary { msg: string; count: number; first_seen: string; last_seen: string }
interface LogItem { id: number; timestamp: string; msg: string; pid: number }
export function IntegrationErrors({ dateFrom, dateTo }: Props) {
  const [summary, setSummary] = useState<Summary[]>([])
  const [drill, setDrill] = useState<{msg:string;items:LogItem[];total:number}|null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => { setLoading(true); fetchIntegrationSummary({date_from:dateFrom,date_to:dateTo}).then(setSummary).finally(()=>setLoading(false)) }, [dateFrom,dateTo])
  const openDrill = async (msg: string) => {
    const data = await fetchIntegrationErrors({search:msg.slice(0,40),date_from:dateFrom,date_to:dateTo,limit:50})
    setDrill({msg,items:data.items,total:data.total})
  }
  return (
    <div className="rounded-xl bg-slate-900/60 border border-orange-500/10 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Zap size={15} className="text-orange-400"/>
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">Ошибки интеграции ERP↔WMS</h3>
        <span className="ml-auto text-xs mono text-orange-400">{summary.reduce((a,s)=>a+s.count,0).toLocaleString()} всего</span>
      </div>
      {loading ? <div className="h-32 flex items-center justify-center text-slate-500 mono text-sm">загрузка...</div> : (
        <div className="overflow-auto max-h-64">
          <table className="w-full text-xs mono border-collapse">
            <thead><tr className="text-slate-500 border-b border-white/5"><th className="text-left py-2 px-3 font-normal">Тип ошибки</th><th className="text-right py-2 px-3 font-normal">Кол-во</th><th className="text-right py-2 px-3 font-normal">Последний раз</th></tr></thead>
            <tbody>{summary.map((s,i) => (
              <tr key={i} className="border-b border-white/[0.03] hover:bg-orange-500/5 cursor-pointer" onClick={()=>openDrill(s.msg)}>
                <td className="py-1.5 px-3 text-slate-300 max-w-xs truncate" title={s.msg}>{s.msg}</td>
                <td className="py-1.5 px-3 text-right text-orange-400 font-semibold">{s.count.toLocaleString()}</td>
                <td className="py-1.5 px-3 text-right text-slate-500 whitespace-nowrap">{new Date(s.last_seen).toLocaleString('ru',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={()=>setDrill(null)}/>
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div><p className="text-xs text-orange-400 mono uppercase tracking-widest mb-1">Drill-down · {drill.total.toLocaleString()} вхождений</p><p className="text-sm text-slate-200 font-medium">{drill.msg}</p></div>
              <button onClick={()=>setDrill(null)} className="text-slate-500 hover:text-slate-200 text-lg">✕</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs mono border-collapse">
                <thead><tr className="text-slate-500 border-b border-white/5"><th className="text-left py-2 px-3 font-normal">Время</th><th className="text-left py-2 px-3 font-normal">PID</th><th className="text-left py-2 px-3 font-normal">Сообщение</th></tr></thead>
                <tbody>{drill.items.map(item => (
                  <tr key={item.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">{new Date(item.timestamp).toLocaleString('ru')}</td>
                    <td className="py-1.5 px-3 text-slate-500">{item.pid}</td>
                    <td className="py-1.5 px-3 text-slate-300 max-w-xs truncate" title={item.msg}>{item.msg}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
EOF

cat > frontend/src/components/OperatorsChart.tsx << 'EOF'
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Users } from 'lucide-react'
import { fetchOperators } from '../api/client'
interface Props { dateFrom: string; dateTo: string }
interface Op { operator: string; operations: number; errors: number }
export function OperatorsChart({ dateFrom, dateTo }: Props) {
  const [data, setData] = useState<Op[]>([])
  useEffect(() => { fetchOperators({date_from:dateFrom,date_to:dateTo}).then(setData) }, [dateFrom,dateTo])
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
      <div className="flex items-center gap-2 mb-4"><Users size={15} className="text-emerald-400"/><h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">Активность операторов ТСД</h3></div>
      {data.length === 0 ? <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{top:0,right:30,left:10,bottom:0}}>
            <XAxis type="number" tick={{fontSize:10,fill:'#475569',fontFamily:'JetBrains Mono'}}/>
            <YAxis type="category" dataKey="operator" width={90} tick={{fontSize:10,fill:'#94a3b8',fontFamily:'JetBrains Mono'}} tickFormatter={v=>v?.length>12?v.slice(0,12)+'…':v}/>
            <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:11}}/>
            <Legend wrapperStyle={{fontSize:10,fontFamily:'JetBrains Mono'}}/>
            <Bar dataKey="operations" name="Операции" fill="#10b981" radius={[0,4,4,0]}/>
            <Bar dataKey="errors" name="Ошибки" fill="#ef4444" radius={[0,4,4,0]}/>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
EOF

cat > frontend/src/components/StatsCards.tsx << 'EOF'
import { AlertTriangle, Activity, Monitor, Zap } from 'lucide-react'
interface Stats { total:number; errors:number; warnings:number; tsd_events:number; errors_24h:number; integration_errors:number }
const cards = [
  { key:'total', label:'Всего записей', icon:Activity, color:'from-blue-900/40 to-blue-800/20', accent:'#3b82f6' },
  { key:'errors', label:'Ошибок всего', icon:AlertTriangle, color:'from-red-900/40 to-red-800/20', accent:'#ef4444' },
  { key:'integration_errors', label:'Ошибок интеграции', icon:Zap, color:'from-orange-900/40 to-orange-800/20', accent:'#f97316' },
  { key:'tsd_events', label:'Событий ТСД', icon:Monitor, color:'from-emerald-900/40 to-emerald-800/20', accent:'#10b981' },
]
export function StatsCards({ stats }: { stats: Stats | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({key,label,icon:Icon,color,accent}) => (
        <div key={key} className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${color} border border-white/5 p-4`}>
          <div className="flex items-start justify-between">
            <div><p className="text-xs text-slate-400 uppercase tracking-widest mb-1">{label}</p><p className="text-3xl font-bold mono" style={{color:accent}}>{stats?(stats[key as keyof Stats]??0).toLocaleString():'—'}</p></div>
            <Icon size={20} style={{color:accent}} className="opacity-60 mt-1"/>
          </div>
          <div className="absolute bottom-0 left-0 h-0.5 w-full" style={{background:`linear-gradient(90deg, ${accent}40, transparent)`}}/>
        </div>
      ))}
    </div>
  )
}
EOF

cat > frontend/src/components/ActivityChart.tsx << 'EOF'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
const LEVEL_COLORS: Record<string,string> = { ERROR:'#ef4444', WARN:'#f97316', INFO:'#3b82f6', DEBUG:'#6b7280', UNKNOWN:'#8b5cf6' }
export function ActivityChart({ data }: { data: Record<string,number|string>[] }) {
  const levels = data.length ? Object.keys(data[0]).filter(k=>k!=='time') : []
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">Активность по уровням</h3>
      {data.length===0 ? <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div> : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{top:5,right:10,left:-20,bottom:5}}>
            <defs>{levels.map(l=><linearGradient key={l} id={`grad-${l}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={LEVEL_COLORS[l]||'#94a3b8'} stopOpacity={0.3}/><stop offset="95%" stopColor={LEVEL_COLORS[l]||'#94a3b8'} stopOpacity={0}/></linearGradient>)}</defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
            <XAxis dataKey="time" tick={{fontSize:10,fill:'#475569',fontFamily:'JetBrains Mono'}} tickFormatter={v=>v?new Date(v).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):''}/>
            <YAxis tick={{fontSize:10,fill:'#475569',fontFamily:'JetBrains Mono'}}/>
            <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:12}} labelFormatter={v=>new Date(v).toLocaleString('ru')}/>
            <Legend wrapperStyle={{fontSize:11,fontFamily:'JetBrains Mono'}}/>
            {levels.map(l=><Area key={l} type="monotone" dataKey={l} stroke={LEVEL_COLORS[l]||'#94a3b8'} fill={`url(#grad-${l})`} strokeWidth={1.5}/>)}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
EOF

cat > frontend/src/components/Charts.tsx << 'EOF'
import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts'
import { fetchLogs } from '../api/client'
interface DrillItem { id:number; timestamp:string; database:string; level_eng:string; msg:string; operator_name:string|null }
export function TopErrors({ data, dateFrom, dateTo }: { data:{msg:string;count:number}[]; dateFrom?:string; dateTo?:string }) {
  const [drill, setDrill] = useState<{msg:string;items:DrillItem[];total:number}|null>(null)
  const openDrill = async (msg: string) => {
    const d = await fetchLogs({search:msg.slice(0,40),level:'ERROR',date_from:dateFrom,date_to:dateTo,limit:50})
    setDrill({msg,items:d.items,total:d.total})
  }
  return (
    <>
      <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">Топ ошибок</h3>
        {data.length===0 ? <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} layout="vertical" margin={{top:0,right:10,left:0,bottom:0}} onClick={e=>e?.activePayload&&openDrill(e.activePayload[0]?.payload?.msg)}>
              <XAxis type="number" tick={{fontSize:10,fill:'#475569',fontFamily:'JetBrains Mono'}}/>
              <YAxis type="category" dataKey="msg" width={160} tick={{fontSize:9,fill:'#94a3b8',fontFamily:'JetBrains Mono'}} tickFormatter={v=>v?.length>22?v.slice(0,22)+'…':v}/>
              <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:11}}/>
              <Bar dataKey="count" radius={[0,4,4,0]} style={{cursor:'pointer'}}>{data.map((_,i)=><Cell key={i} fill={`hsl(${i*15},80%,55%)`}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="text-xs text-slate-600 mono mt-2 text-center">↑ кликни на строку для drill-down</p>
      </div>
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={()=>setDrill(null)}/>
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div><p className="text-xs text-red-400 mono uppercase tracking-widest mb-1">Drill-down · {drill.total.toLocaleString()} вхождений</p><p className="text-sm text-slate-200 font-medium">{drill.msg}</p></div>
              <button onClick={()=>setDrill(null)} className="text-slate-500 hover:text-slate-200 text-lg">✕</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs mono border-collapse">
                <thead><tr className="text-slate-500 border-b border-white/5"><th className="text-left py-2 px-3 font-normal">Время</th><th className="text-left py-2 px-3 font-normal">БД</th><th className="text-left py-2 px-3 font-normal">Оператор</th><th className="text-left py-2 px-3 font-normal">Сообщение</th></tr></thead>
                <tbody>{drill.items.map(item=>(
                  <tr key={item.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">{new Date(item.timestamp).toLocaleString('ru')}</td>
                    <td className="py-1.5 px-3 text-slate-400">{item.database}</td>
                    <td className="py-1.5 px-3 text-emerald-400">{item.operator_name||'—'}</td>
                    <td className="py-1.5 px-3 text-slate-300 max-w-xs truncate" title={item.msg}>{item.msg}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
const DB_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f97316','#ef4444','#06b6d4']
export function DatabasesChart({ data }: { data:{database:string;count:number}[] }) {
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">По базам данных</h3>
      {data.length===0 ? <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div> : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="database" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>{data.map((_,i)=><Cell key={i} fill={DB_COLORS[i%DB_COLORS.length]}/>)}</Pie>
            <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:11}}/>
            <Legend wrapperStyle={{fontSize:10,fontFamily:'JetBrains Mono'}}/>
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
EOF

cat > frontend/src/components/ErrorFeed.tsx << 'EOF'
import { useState, useEffect } from 'react'
import { Search, Filter, Download } from 'lucide-react'
import clsx from 'clsx'
import { fetchLogs, fetchFilterDatabases, exportUrl } from '../api/client'
const LEVEL_BADGE: Record<string,string> = { ERROR:'bg-red-500/20 text-red-400 border-red-500/30', WARN:'bg-orange-500/20 text-orange-400 border-orange-500/30', INFO:'bg-blue-500/20 text-blue-400 border-blue-500/30', DEBUG:'bg-slate-500/20 text-slate-400 border-slate-500/30', UNKNOWN:'bg-purple-500/20 text-purple-400 border-purple-500/30' }
interface LogItem { id:number; timestamp:string; database:string; level_eng:string; msg:string; is_tsd:boolean; operator_name:string|null }
interface Props { dateFrom:string; dateTo:string; initLevel?:string; initDatabase?:string; initSearch?:string; onFilterChange?:(f:{level:string;database:string;search:string})=>void }
export function ErrorFeed({ dateFrom, dateTo, initLevel='', initDatabase='', initSearch='', onFilterChange }: Props) {
  const [logs, setLogs] = useState<LogItem[]>([]); const [total, setTotal] = useState(0)
  const [search, setSearch] = useState(initSearch); const [level, setLevel] = useState(initLevel)
  const [database, setDatabase] = useState(initDatabase); const [isTsd, setIsTsd] = useState<boolean|undefined>(undefined)
  const [databases, setDatabases] = useState<string[]>([]); const [loading, setLoading] = useState(false); const [offset, setOffset] = useState(0)
  const LIMIT = 50
  useEffect(() => { fetchFilterDatabases().then(setDatabases) }, [])
  useEffect(() => { setOffset(0) }, [search,level,database,isTsd,dateFrom,dateTo])
  useEffect(() => { onFilterChange?.({level,database,search}) }, [level,database,search])
  useEffect(() => {
    setLoading(true)
    fetchLogs({level,database,search,is_tsd:isTsd,limit:LIMIT,offset,date_from:dateFrom,date_to:dateTo}).then(d=>{setLogs(d.items);setTotal(d.total)}).finally(()=>setLoading(false))
  }, [search,level,database,isTsd,offset,dateFrom,dateTo])
  useEffect(() => {
    const t = setInterval(() => fetchLogs({level,database,search,is_tsd:isTsd,limit:LIMIT,offset:0,date_from:dateFrom,date_to:dateTo}).then(d=>{setLogs(d.items);setTotal(d.total)}), 15000)
    return () => clearInterval(t)
  }, [level,database,search,isTsd,dateFrom,dateTo])
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input className="w-full bg-slate-800/60 border border-white/5 rounded-lg pl-8 pr-3 py-2 text-sm mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50" placeholder="Поиск по тексту..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <select className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none" value={level} onChange={e=>setLevel(e.target.value)}><option value="">Все уровни</option>{['ERROR','WARN','INFO','DEBUG'].map(l=><option key={l} value={l}>{l}</option>)}</select>
        <select className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none" value={database} onChange={e=>setDatabase(e.target.value)}><option value="">Все БД</option>{databases.map(d=><option key={d} value={d}>{d}</option>)}</select>
        <button onClick={()=>setIsTsd(isTsd===undefined?true:undefined)} className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors',isTsd?'bg-emerald-500/20 text-emerald-400 border-emerald-500/30':'bg-slate-800/60 text-slate-400 border-white/5')}><Filter size={13}/> ТСД</button>
        <a href={exportUrl({level,database,search,date_from:dateFrom,date_to:dateTo})} download="wms_logs.csv" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border bg-slate-800/60 text-slate-400 border-white/5 hover:bg-slate-700 transition-colors"><Download size={13}/> CSV</a>
        <span className="mono text-xs text-slate-500 ml-auto">{total.toLocaleString()} записей</span>
      </div>
      <div className="overflow-auto max-h-[420px] rounded-lg">
        {loading&&logs.length===0?<div className="flex items-center justify-center h-32 text-slate-500 mono text-sm">загрузка...</div>:(
          <table className="w-full text-xs mono border-collapse">
            <thead><tr className="text-slate-500 border-b border-white/5"><th className="text-left py-2 px-3 font-normal whitespace-nowrap">Время</th><th className="text-left py-2 px-3 font-normal">Уровень</th><th className="text-left py-2 px-3 font-normal">БД</th><th className="text-left py-2 px-3 font-normal">Оператор</th><th className="text-left py-2 px-3 font-normal">Сообщение</th></tr></thead>
            <tbody>{logs.map(log=>(
              <tr key={log.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">{new Date(log.timestamp).toLocaleString('ru',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
                <td className="py-1.5 px-3"><span className={clsx('px-1.5 py-0.5 rounded border text-[10px]',LEVEL_BADGE[log.level_eng]||LEVEL_BADGE.UNKNOWN)}>{log.level_eng}</span></td>
                <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap max-w-[100px] truncate">{log.database}</td>
                <td className="py-1.5 px-3 text-emerald-400 whitespace-nowrap">{log.operator_name||'—'}</td>
                <td className="py-1.5 px-3 text-slate-300 max-w-[400px] truncate" title={log.msg}>{log.msg}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="flex gap-2 justify-end items-center">
        <button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-LIMIT))} className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-400 disabled:opacity-30 hover:bg-slate-700">← Назад</button>
        <span className="text-xs text-slate-500 mono">{offset+1}–{Math.min(offset+LIMIT,total)}</span>
        <button disabled={offset+LIMIT>=total} onClick={()=>setOffset(offset+LIMIT)} className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-400 disabled:opacity-30 hover:bg-slate-700">Вперёд →</button>
      </div>
    </div>
  )
}
EOF

cat > frontend/src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Syne', sans-serif; min-height: 100vh; transition: background 0.2s, color 0.2s; }
body.dark { background: #080c12; color: #e2e8f0; }
body.light { background: #f1f5f9; color: #1e293b; }
.mono { font-family: 'JetBrains Mono', monospace; }
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
@keyframes slide-in-from-right-4 { from { transform: translateX(1rem); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
.animate-in { animation: slide-in-from-right-4 0.2s ease-out; }
EOF

cat > frontend/src/App.tsx << 'EOF'
import { useState, useEffect, useRef } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { StatsCards } from './components/StatsCards'
import { ActivityChart } from './components/ActivityChart'
import { TopErrors, DatabasesChart } from './components/Charts'
import { ErrorFeed } from './components/ErrorFeed'
import { IntegrationErrors } from './components/IntegrationErrors'
import { OperatorsChart } from './components/OperatorsChart'
import { DateRangePicker } from './components/DateRangePicker'
import { ThemeToggle } from './components/ThemeToggle'
import { ToastProvider, useToast } from './components/Toast'
import { useUrlFilters } from './api/useUrlFilters'
import { fetchStats, fetchActivityChart, fetchDatabasesChart, fetchTopErrors, fetchWatchdog, fetchDateRange } from './api/client'

function Dashboard() {
  const { filters, setFilters } = useUrlFilters()
  const [stats, setStats] = useState<any>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [databases, setDatabases] = useState<any[]>([])
  const [topErrors, setTopErrors] = useState<any[]>([])
  const [dateRange, setDateRange] = useState<{min?:string;max?:string}>({})
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [refreshing, setRefreshing] = useState(false)
  const [dark, setDark] = useState(true)
  const { push } = useToast()
  const prevWatchdog = useRef<Set<string>>(new Set())
  useEffect(() => { document.body.className = dark ? 'dark' : 'light' }, [dark])
  const p = { date_from: filters.dateFrom, date_to: filters.dateTo }
  const loadAll = async () => {
    setRefreshing(true)
    try {
      const [s,a,d,e] = await Promise.all([fetchStats(p),fetchActivityChart(p),fetchDatabasesChart(p),fetchTopErrors(p)])
      setStats(s); setActivity(a); setDatabases(d); setTopErrors(e); setLastUpdate(new Date())
    } finally { setRefreshing(false) }
  }
  const checkWatchdog = async () => {
    const items = await fetchWatchdog()
    items.forEach((item: {msg:string;count:number}) => {
      if (!prevWatchdog.current.has(item.msg)) { push({type:'error',title:'🚨 Новый тип ошибки',msg:item.msg}); prevWatchdog.current.add(item.msg) }
    })
  }
  useEffect(() => {
    fetchDateRange().then(setDateRange); loadAll(); checkWatchdog()
    const t1 = setInterval(loadAll, 30000); const t2 = setInterval(checkWatchdog, 60000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [filters.dateFrom, filters.dateTo])
  return (
    <div className={`min-h-screen p-4 lg:p-6 flex flex-col gap-4 ${dark?'bg-[#080c12] text-slate-200':'bg-slate-100 text-slate-800'}`}>
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center"><Activity size={16} className="text-blue-400"/></div>
          <div><h1 className="text-lg font-bold tracking-tight" style={{fontFamily:'Syne'}}>WMS <span className="text-blue-400">Monitor</span></h1><p className="text-xs text-slate-500 mono">LEAD WMS · PostgreSQL logs</p></div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker dateFrom={filters.dateFrom} dateTo={filters.dateTo} minDate={dateRange.min} maxDate={dateRange.max} onChange={(from,to)=>setFilters(f=>({...f,dateFrom:from,dateTo:to}))}/>
          <ThemeToggle dark={dark} onToggle={()=>setDark(d=>!d)}/>
          <span className="text-xs text-slate-500 mono hidden sm:block">{lastUpdate.toLocaleTimeString('ru')}</span>
          <button onClick={loadAll} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs hover:bg-slate-700 transition-colors disabled:opacity-50"><RefreshCw size={12} className={refreshing?'animate-spin':''}/> Обновить</button>
        </div>
      </header>
      <StatsCards stats={stats}/>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><ActivityChart data={activity}/></div>
        <DatabasesChart data={databases}/>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopErrors data={topErrors} dateFrom={filters.dateFrom} dateTo={filters.dateTo}/>
        <OperatorsChart dateFrom={filters.dateFrom} dateTo={filters.dateTo}/>
      </div>
      <IntegrationErrors dateFrom={filters.dateFrom} dateTo={filters.dateTo}/>
      <div>
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-3">Лента событий</h2>
        <ErrorFeed dateFrom={filters.dateFrom} dateTo={filters.dateTo} initLevel={filters.level} initDatabase={filters.database} initSearch={filters.search} onFilterChange={f=>setFilters(prev=>({...prev,...f}))}/>
      </div>
      <footer className="text-center text-xs text-slate-600 mono pb-2">WMS Monitor · React + FastAPI + PostgreSQL</footer>
    </div>
  )
}

export default function App() {
  return <ToastProvider><Dashboard/></ToastProvider>
}
EOF

echo "✅ All files updated!"
