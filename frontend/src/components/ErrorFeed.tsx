import { useState, useRef, useCallback } from 'react'
import { Search, Filter, Download, X } from 'lucide-react'
import clsx from 'clsx'
import { fetchLogs, fetchFilterDatabases, exportUrl } from '../api/client'
import { useEffect } from 'react'

const LEVEL_BADGE: Record<string, string> = {
  ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  WARN: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  INFO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  DEBUG: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  UNKNOWN: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
}

interface LogItem {
  id: number; timestamp: string; pid: number; database: string
  level_eng: string; msg: string; is_tsd: boolean
  operator_name: string | null; terminal_uuid: string | null
}

interface SearchState {
  text: string; operator: string; uuid: string; pid: string
}

interface Props {
  dateFrom: string; dateTo: string
  initLevel?: string; initDatabase?: string; initSearch?: string
  onFilterChange?: (f: { level: string; database: string; search: string }) => void
}

export function ErrorFeed({ dateFrom, dateTo, initLevel = '', initDatabase = '', initSearch = '', onFilterChange }: Props) {
  const [logs, setLogs] = useState<LogItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const LIMIT = 100

  // Поисковые поля — черновики (то что печатает пользователь)
  const [draft, setDraft] = useState<SearchState>({
    text: initSearch, operator: '', uuid: '', pid: ''
  })

  // Применённые фильтры — только они триггерят запрос
  const [applied, setApplied] = useState<SearchState>({
    text: initSearch, operator: '', uuid: '', pid: ''
  })

  const [level, setLevel] = useState(initLevel)
  const [database, setDatabase] = useState(initDatabase)
  const [isTsd, setIsTsd] = useState<boolean | undefined>(undefined)
  const [databases, setDatabases] = useState<string[]>([])

  useEffect(() => { fetchFilterDatabases().then(setDatabases) }, [])
  useEffect(() => { setOffset(0) }, [applied, level, database, isTsd, dateFrom, dateTo])
  useEffect(() => { onFilterChange?.({ level, database, search: applied.text }) }, [level, database, applied.text])

  const load = useCallback(() => {
    setLoading(true)
    fetchLogs({
      level, database,
      search: applied.text || undefined,
      operator: applied.operator || undefined,
      uuid: applied.uuid || undefined,
      pid: applied.pid || undefined,
      is_tsd: isTsd,
      limit: LIMIT, offset,
      date_from: dateFrom, date_to: dateTo,
    }).then(d => { setLogs(d.items); setTotal(d.total) }).finally(() => setLoading(false))
  }, [applied, level, database, isTsd, offset, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const applySearch = () => {
    setOffset(0)
    setApplied({ ...draft })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') applySearch()
  }

  const clearAll = () => {
    const empty = { text: '', operator: '', uuid: '', pid: '' }
    setDraft(empty); setApplied(empty)
    setLevel(''); setDatabase(''); setIsTsd(undefined)
  }

  const hasFilters = applied.text || applied.operator || applied.uuid || applied.pid || level || database || isTsd !== undefined

  const csvHref = exportUrl({
    level, database,
    search: applied.text || undefined,
    date_from: dateFrom, date_to: dateTo,
  })

  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4 flex flex-col gap-3">

      {/* Строка 1: поисковые поля */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input
            className="w-full bg-slate-800/60 border border-white/5 rounded-lg pl-8 pr-3 py-2 text-xs mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
            placeholder="Текст сообщения..."
            value={draft.text}
            onChange={e => setDraft(d => ({ ...d, text: e.target.value }))}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="relative">
          <input
            className="w-full bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-xs mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
            placeholder="Оператор (Бубен...)"
            value={draft.operator}
            onChange={e => setDraft(d => ({ ...d, operator: e.target.value }))}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="relative">
          <input
            className="w-full bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-xs mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500/50"
            placeholder="UUID терминала (XP-...)"
            value={draft.uuid}
            onChange={e => setDraft(d => ({ ...d, uuid: e.target.value }))}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="relative">
          <input
            className="w-full bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-xs mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
            placeholder="PID процесса"
            value={draft.pid}
            onChange={e => setDraft(d => ({ ...d, pid: e.target.value }))}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>

      {/* Строка 2: фильтры + кнопки */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
          value={level} onChange={e => setLevel(e.target.value)}
        >
          <option value="">Все уровни</option>
          {['ERROR','WARN','INFO','DEBUG'].map(l => <option key={l} value={l}>{l}</option>)}
        </select>

        <select
          className="bg-slate-800/60 border border-white/5 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none"
          value={database} onChange={e => setDatabase(e.target.value)}
        >
          <option value="">Все БД</option>
          {databases.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        <button
          onClick={() => setIsTsd(isTsd === undefined ? true : undefined)}
          className={clsx('flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-colors',
            isTsd ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-800/60 text-slate-400 border-white/5'
          )}
        >
          <Filter size={12}/> ТСД
        </button>

        <button
          onClick={applySearch}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          <Search size={12}/> Поиск
        </button>

        {hasFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-slate-800/60 border border-white/5 text-slate-400 hover:bg-slate-700 transition-colors"
          >
            <X size={12}/> Сбросить
          </button>
        )}

        <a href={csvHref} download="wms_logs.csv"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border bg-slate-800/60 text-slate-400 border-white/5 hover:bg-slate-700 transition-colors ml-auto">
          <Download size={12}/> CSV
        </a>

        <span className="mono text-xs text-slate-500">{total.toLocaleString()} записей</span>
      </div>

      {/* Активные фильтры — бейджи */}
      {hasFilters && (
        <div className="flex flex-wrap gap-1.5">
          {applied.text && <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/20 mono">текст: {applied.text}</span>}
          {applied.operator && <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 mono">оператор: {applied.operator}</span>}
          {applied.uuid && <span className="px-2 py-0.5 text-xs rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/20 mono">UUID: {applied.uuid.slice(0,16)}…</span>}
          {applied.pid && <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/20 mono">PID: {applied.pid}</span>}
          {level && <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-300 border border-red-500/20 mono">уровень: {level}</span>}
          {database && <span className="px-2 py-0.5 text-xs rounded-full bg-slate-500/20 text-slate-300 border border-slate-500/20 mono">БД: {database}</span>}
        </div>
      )}

      {/* Таблица */}
      <div className="overflow-auto max-h-[520px] rounded-lg">
        {loading && logs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 mono text-sm">загрузка...</div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-slate-500 mono text-sm">ничего не найдено</div>
        ) : (
          <table className="w-full text-xs mono border-collapse">
            <thead className="sticky top-0 bg-slate-900 z-10">
              <tr className="text-slate-500 border-b border-white/5">
                <th className="text-left py-2 px-3 font-normal whitespace-nowrap">Время</th>
                <th className="text-left py-2 px-3 font-normal">Уровень</th>
                <th className="text-left py-2 px-3 font-normal">БД</th>
                <th className="text-left py-2 px-3 font-normal">PID</th>
                <th className="text-left py-2 px-3 font-normal">Оператор</th>
                <th className="text-left py-2 px-3 font-normal">UUID терминала</th>
                <th className="text-left py-2 px-3 font-normal">Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">
                    {new Date(log.timestamp).toLocaleString('ru', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })}
                  </td>
                  <td className="py-1.5 px-3">
                    <span className={clsx('px-1.5 py-0.5 rounded border text-[10px]', LEVEL_BADGE[log.level_eng] || LEVEL_BADGE.UNKNOWN)}>
                      {log.level_eng}
                    </span>
                  </td>
                  <td className="py-1.5 px-3 text-slate-400 max-w-[90px] truncate">{log.database}</td>
                  <td className="py-1.5 px-3 text-slate-500">{log.pid}</td>
                  <td className="py-1.5 px-3 text-emerald-400 whitespace-nowrap">{log.operator_name || '—'}</td>
                  <td className="py-1.5 px-3 text-orange-400/80 max-w-[120px] truncate" title={log.terminal_uuid || ''}>
                    {log.terminal_uuid ? log.terminal_uuid.slice(0, 12) + '…' : '—'}
                  </td>
                  <td className="py-1.5 px-3 text-slate-300 max-w-[380px] truncate" title={log.msg}>{log.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Пагинация */}
      <div className="flex gap-2 justify-end items-center">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-400 disabled:opacity-30 hover:bg-slate-700">
          ← Назад
        </button>
        <span className="text-xs text-slate-500 mono">{offset + 1}–{Math.min(offset + LIMIT, total)} из {total.toLocaleString()}</span>
        <button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}
          className="px-3 py-1 text-xs rounded bg-slate-800 text-slate-400 disabled:opacity-30 hover:bg-slate-700">
          Вперёд →
        </button>
      </div>
    </div>
  )
}
