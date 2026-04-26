import { useState } from 'react'
import { Monitor, AlertTriangle, Clock, ChevronRight } from 'lucide-react'
import { BASE } from '../api/client'
import clsx from 'clsx'

interface SessionInfo {
  operator: string
  terminal_uuid: string
  events: number
  errors: number
  first_seen: string
  last_seen: string
}

interface TimelineEvent {
  timestamp: string
  level_eng: string
  operator: string
  database: string
  screen_texts: string[]
  msg_short: string
  is_error: boolean
}

function qs(p: Record<string, any>) {
  const q = new URLSearchParams()
  Object.entries(p).forEach(([k,v]) => { if (v) q.set(k, String(v)) })
  return q.toString() ? `?${q}` : ''
}

export function SessionsView({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [selected, setSelected] = useState<SessionInfo | null>(null)
  const [searchOp, setSearchOp] = useState('')
  const [searchUuid, setSearchUuid] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingTimeline, setLoadingTimeline] = useState(false)

  const loadSessions = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${BASE}/api/sessions/operators${qs({ date_from: dateFrom, date_to: dateTo })}`)
      const data = await r.json()
      setSessions(data)
    } finally { setLoading(false) }
  }

  const loadTimeline = async (session: SessionInfo) => {
    setSelected(session)
    setLoadingTimeline(true)
    try {
      const r = await fetch(`${BASE}/api/sessions/timeline${qs({
        terminal_uuid: session.terminal_uuid,
        date_from: dateFrom,
        date_to: dateTo
      })}`)
      setTimeline(await r.json())
    } finally { setLoadingTimeline(false) }
  }

  const filtered = sessions.filter(s =>
    (!searchOp || s.operator.toLowerCase().includes(searchOp.toLowerCase())) &&
    (!searchUuid || s.terminal_uuid.toLowerCase().includes(searchUuid.toLowerCase()))
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Поиск и загрузка */}
      <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs text-slate-500 mono">Оператор</label>
            <input
              className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-sm mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              placeholder="Гембель..."
              value={searchOp}
              onChange={e => setSearchOp(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs text-slate-500 mono">UUID терминала</label>
            <input
              className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-sm mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
              placeholder="XP-..."
              value={searchUuid}
              onChange={e => setSearchUuid(e.target.value)}
            />
          </div>
          <button
            onClick={loadSessions}
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Загрузка...' : 'Найти сессии'}
          </button>
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Список сессий */}
          <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
            <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              <Monitor size={13}/> Сессии ({filtered.length})
            </h3>
            <div className="overflow-auto max-h-[500px] flex flex-col gap-1">
              {filtered.map((s, i) => (
                <div
                  key={i}
                  onClick={() => loadTimeline(s)}
                  className={clsx(
                    'p-3 rounded-lg cursor-pointer transition-colors border',
                    selected?.terminal_uuid === s.terminal_uuid
                      ? 'bg-blue-500/10 border-blue-500/30'
                      : 'bg-slate-800/40 border-white/5 hover:bg-slate-800/80'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {s.operator}
                      </p>
                      <p className="text-xs mono text-orange-400/70 truncate">{s.terminal_uuid}</p>
                    </div>
                    <div className="flex flex-col items-end shrink-0 gap-1">
                      {s.errors > 0 && (
                        <span className="flex items-center gap-1 text-xs text-red-400">
                          <AlertTriangle size={10}/>{s.errors}
                        </span>
                      )}
                      <span className="text-xs text-slate-500 mono">{s.events} событий</span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-1.5">
                    <span className="text-[10px] mono text-slate-600">
                      {new Date(s.first_seen).toLocaleString('ru', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
                    </span>
                    <span className="text-[10px] text-slate-700">→</span>
                    <span className="text-[10px] mono text-slate-600">
                      {new Date(s.last_seen).toLocaleString('ru', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Таймлайн */}
          <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-slate-600 mono text-sm">
                Выберите сессию слева
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={13} className="text-blue-400"/>
                  <h3 className="text-xs text-slate-400 uppercase tracking-widest">
                    Таймлайн — {selected.operator}
                  </h3>
                </div>
                {loadingTimeline ? (
                  <div className="h-32 flex items-center justify-center text-slate-500 mono text-sm">загрузка...</div>
                ) : (
                  <div className="overflow-auto max-h-[500px]">
                    <div className="relative">
                      {/* Вертикальная линия */}
                      <div className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-700"/>

                      <div className="flex flex-col gap-1 pl-6">
                        {timeline.map((event, i) => (
                          <div key={i} className="relative">
                            {/* Точка на линии */}
                            <div className={clsx(
                              'absolute -left-6 top-2 w-3.5 h-3.5 rounded-full border-2 border-slate-900 z-10',
                              event.is_error ? 'bg-red-500' :
                              event.screen_texts.length > 0 ? 'bg-blue-500' : 'bg-slate-600'
                            )}/>

                            <div className={clsx(
                              'p-2 rounded-lg border text-xs',
                              event.is_error
                                ? 'bg-red-500/10 border-red-500/20'
                                : event.screen_texts.length > 0
                                  ? 'bg-slate-800/60 border-blue-500/10'
                                  : 'bg-slate-800/30 border-white/[0.03]'
                            )}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="mono text-slate-500 text-[10px]">
                                  {new Date(event.timestamp).toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                                </span>
                                <span className={clsx(
                                  'px-1 py-0.5 rounded text-[9px] border',
                                  event.is_error
                                    ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                    : 'bg-slate-700 text-slate-400 border-slate-600'
                                )}>
                                  {event.level_eng}
                                </span>
                                <span className="text-slate-600 text-[10px] mono">{event.database}</span>
                              </div>

                              {/* Экраны ТСД */}
                              {event.screen_texts.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-1">
                                  {event.screen_texts.map((t, j) => (
                                    <span key={j} className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 text-[10px] border border-blue-500/20">
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {/* Текст ошибки */}
                              {event.is_error && (
                                <p className="text-red-300 text-[10px] mono leading-relaxed truncate" title={event.msg_short}>
                                  {event.msg_short}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
