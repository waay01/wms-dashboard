import { useState, useEffect, useRef } from 'react'
import { Search, Filter } from 'lucide-react'
import clsx from 'clsx'
import { fetchLogs, fetchFilterDatabases } from '../api/client'

const LEVEL_BADGE: Record<string, string> = {
  ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  WARN: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  INFO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  DEBUG: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  UNKNOWN: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
}

interface LogItem {
  id: number
  timestamp: string
  database: string
  level_eng: string
  msg: string
  is_tsd: boolean
  operator_name: string | null
}

export function ErrorFeed() {
  const [logs, setLogs] = useState<LogItem[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState('')
  const [database, setDatabase] = useState('')
  const [isTsd, setIsTsd] = useState<boolean | undefined>(undefined)
  const [databases, setDatabases] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const LIMIT = 50

  useEffect(() => {
    fetchFilterDatabases().then(setDatabases)
  }, [])

  useEffect(() => {
    setOffset(0)
  }, [search, level, database, isTsd])

  useEffect(() => {
    setLoading(true)
    fetchLogs({ level, database, search, is_tsd: isTsd, limit: LIMIT, offset })
      .then(d => { setLogs(d.items); setTotal(d.total) })
      .finally(() => setLoading(false))
  }, [search, level, database, isTsd, offset])

  // Автообновление каждые 10 сек
  useEffect(() => {
    const t = setInterval(() => {
      fetchLogs({ level, database, search, is_tsd: isTsd, limit: LIMIT, offset: 0 })
        .then(d => { setLogs(d.items); setTotal(d.total) })
    }, 10000)
    return () => clearInterval(t)
  }, [level, database, search, isTsd])

  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4 flex flex-col gap-3">
      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="w-full bg-slate-800/60 border border-white/5 rounded-lg pl-8 pr-3 py-2 text-sm mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            placeholder="Поиск по тексту..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
          value={level}
          onChange={e => setLevel(e.target.value)}
        >
          <option value="">Все уровни</option>
          {['ERROR', 'WARN', 'INFO', 'DEBUG'].map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <select
          className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50"
          value={database}
          onChange={e => setDatabase(e.target.value)}
        >
          <option value="">Все БД</option>
          {databases.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        <button
          onClick={() => setIsTsd(isTsd === undefined ? true : undefined)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors',
            isTsd
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
              : 'bg-slate-800/60 text-slate-400 border-white/5'
          )}
        >
          <Filter size={13} /> ТСД
        </button>

        <span className="mono text-xs text-slate-500 ml-auto">{total.toLocaleString()} записей</span>
      </div>

      {/* Таблица */}
      <div className="overflow-auto max-h-[420px] rounded-lg">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 mono text-sm">загрузка...</div>
        ) : (
          <table className="w-full text-xs mono border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-white/5">
                <th className="text-left py-2 px-3 font-normal whitespace-nowrap">Время</th>
                <th className="text-left py-2 px-3 font-normal">Уровень</th>
                <th className="text-left py-2 px-3 font-normal">БД</th>
                <th className="text-left py-2 px-3 font-normal">Оператор</th>
                <th className="text-left py-2 px-3 font-normal">Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString('ru', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="py-1.5 px-3">
                    <span className={clsx('px-1.5 py-0.5 rounded border text-[10px]', LEVEL_BADGE[log.level_eng] || LEVEL_BADGE.UNKNOWN)}>
                      {log.level_eng}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap max-w-[100px] truncate">{log.database}</td>
                  <td className="py-1.5 px-3 text-emerald-400 whitespace-nowrap">{log.operator_name || '—'}</td>
                  <td className="py-1.5 px-3 text-slate-300 max-w-[400px] truncate" title={log.msg}>{log.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Пагинация */}
      <div className="flex gap-2 justify-end items-center">
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-400 disabled:opacity-30 hover:bg-slate-700 transition-colors"
        >← Назад</button>
        <span className="text-xs text-slate-500 mono">{offset + 1}–{Math.min(offset + LIMIT, total)}</span>
        <button
          disabled={offset + LIMIT >= total}
          onClick={() => setOffset(offset + LIMIT)}
          className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-400 disabled:opacity-30 hover:bg-slate-700 transition-colors"
        >Вперёд →</button>
      </div>
    </div>
  )
}
