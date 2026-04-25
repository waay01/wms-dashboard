import { useState, useEffect, useRef } from 'react'
import { Radio } from 'lucide-react'
import clsx from 'clsx'
import { BASE } from '../api/client'

interface LiveEntry {
  id: number
  timestamp: string
  level_eng: string
  database: string
  msg: string
  operator_name: string | null
}

const LEVEL_BADGE: Record<string, string> = {
  ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  WARN: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}

export function LiveFeed() {
  const [entries, setEntries] = useState<LiveEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pausedRef = useRef(false)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    const wsUrl = BASE.replace('http', 'ws') + '/ws/live'
    const connect = () => {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onclose = () => { setConnected(false); setTimeout(connect, 3000) }
      ws.onerror = () => ws.close()
      ws.onmessage = (e) => {
        if (pausedRef.current) return
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'live') {
            setEntries(prev => [data, ...prev].slice(0, 200))
          }
        } catch {}
      }
    }
    connect()
    return () => wsRef.current?.close()
  }, [])

  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
      <div className="flex items-center gap-3 mb-4">
        <Radio size={15} className={connected ? 'text-emerald-400 animate-pulse' : 'text-slate-500'} />
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">
          Live поток
        </h3>
        <span className={clsx('text-xs mono px-2 py-0.5 rounded-full border',
          connected ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-slate-500 border-slate-700 bg-slate-800')}>
          {connected ? 'подключён' : 'переподключение...'}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setPaused(p => !p)}
            className={clsx('px-3 py-1 text-xs rounded-lg border transition-colors',
              paused ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-slate-800 text-slate-400 border-white/5 hover:bg-slate-700')}>
            {paused ? '▶ Возобновить' : '⏸ Пауза'}
          </button>
          <button onClick={() => setEntries([])}
            className="px-3 py-1 text-xs rounded-lg bg-slate-800 text-slate-400 border border-white/5 hover:bg-slate-700">
            Очистить
          </button>
        </div>
      </div>

      <div className="overflow-auto max-h-64 rounded-lg">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-slate-600 mono text-sm">
            {connected ? 'ожидание новых событий...' : 'нет подключения'}
          </div>
        ) : (
          <table className="w-full text-xs mono border-collapse">
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.id}-${i}`} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap w-36">
                    {new Date(e.timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="py-1.5 px-3 w-20">
                    <span className={clsx('px-1.5 py-0.5 rounded border text-[10px]', LEVEL_BADGE[e.level_eng] || 'text-slate-400')}>
                      {e.level_eng}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-slate-400 w-28 truncate">{e.database}</td>
                  <td className="py-1.5 px-3 text-emerald-400 w-24 truncate">{e.operator_name || '—'}</td>
                  <td className="py-1.5 px-3 text-slate-300 max-w-sm truncate" title={e.msg}>{e.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
