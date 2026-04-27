import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, RefreshCw, Play, Pause } from 'lucide-react'
import { StatsCards } from './components/StatsCards'
import { ActivityChart } from './components/ActivityChart'
import { TopErrors, DatabasesChart } from './components/Charts'
import { ErrorFeed } from './components/ErrorFeed'
import { LiveFeed } from './components/LiveFeed'
import { IntegrationErrors } from './components/IntegrationErrors'
import { OperatorsChart } from './components/OperatorsChart'
import { DateRangePicker } from './components/DateRangePicker'
import { ThemeToggle } from './components/ThemeToggle'
import { ToastProvider, useToast } from './components/Toast'
import { RescanButton } from './components/RescanButton'
import { SessionsView } from './components/SessionsView'
import { CompareView } from './components/CompareView'
import { useUrlFilters } from './api/useUrlFilters'
import { fetchStats, fetchActivityChart, fetchDatabasesChart, fetchTopErrors, fetchWatchdog, fetchDateRange } from './api/client'

type Tab = 'dashboard' | 'compare' | 'sessions'

function Dashboard() {
  const { filters, setFilters } = useUrlFilters()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [stats, setStats] = useState<any>(null)
  const [activity, setActivity] = useState<any[]>([])
  const [databases, setDatabases] = useState<any[]>([])
  const [topErrors, setTopErrors] = useState<any[]>([])
  const [dateRange, setDateRange] = useState<{min?:string;max?:string}>({})
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [refreshing, setRefreshing] = useState(false)
  const [dark, setDark] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const { push } = useToast()
  const prevWatchdog = useRef<Set<string>>(new Set())
  const autoRefreshRef = useRef(false)

  useEffect(() => { document.body.className = dark ? 'dark' : 'light' }, [dark])
  useEffect(() => { autoRefreshRef.current = autoRefresh }, [autoRefresh])

  const p = { date_from: filters.dateFrom, date_to: filters.dateTo }

  const loadAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const [s,a,d,e] = await Promise.all([
        fetchStats(p), fetchActivityChart(p), fetchDatabasesChart(p), fetchTopErrors(p)
      ])
      setStats(s); setActivity(a); setDatabases(d); setTopErrors(e)
      setLastUpdate(new Date())
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
    } finally { setRefreshing(false) }
  }, [filters.dateFrom, filters.dateTo])

  const checkWatchdog = useCallback(async () => {
    try {
      const items = await fetchWatchdog()
      items.forEach((item: {msg:string;count:number}) => {
        if (!prevWatchdog.current.has(item.msg)) {
          push({type:'error', title:'Новый тип ошибки', msg:item.msg})
          prevWatchdog.current.add(item.msg)
        }
      })
    } catch (err) {
      console.error('Watchdog check failed:', err)
    }
  }, [push])

  useEffect(() => {
    fetchDateRange().then(setDateRange).catch(() => {})
    loadAll()
    checkWatchdog()
  }, [loadAll, checkWatchdog])

  useEffect(() => {
    if (!autoRefresh) return
    const t1 = setInterval(() => { if (autoRefreshRef.current) loadAll() }, 30000)
    const t2 = setInterval(() => { if (autoRefreshRef.current) checkWatchdog() }, 60000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [autoRefresh, loadAll, checkWatchdog])

  const txtPrimary = dark ? 'text-slate-200' : 'text-slate-800'
  const txtSecondary = dark ? 'text-slate-400' : 'text-slate-600'
  const bg = dark ? 'bg-[#080c12]' : 'bg-slate-100'

  return (
    <div className={`min-h-screen p-4 lg:p-6 flex flex-col gap-4 ${bg} ${txtPrimary}`}>
      {/* Header */}
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <Activity size={16} className="text-blue-400"/>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight" style={{fontFamily:'Syne'}}>
              WMS <span className="text-blue-400">Monitor</span>
            </h1>
            <p className={`text-xs mono ${txtSecondary}`}>LEAD WMS · PostgreSQL logs</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker dateFrom={filters.dateFrom} dateTo={filters.dateTo} minDate={dateRange.min} maxDate={dateRange.max}
            onChange={(from,to) => setFilters(f => ({...f, dateFrom:from, dateTo:to}))}/>
          <RescanButton/>
          <ThemeToggle dark={dark} onToggle={() => setDark(d => !d)}/>
          <button
            onClick={() => setAutoRefresh(a => !a)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors ${
              autoRefresh
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-800/60 text-slate-400 border-white/5 hover:bg-slate-700'
            }`}
            title={autoRefresh ? 'Автообновление включено (30с)' : 'Автообновление выключено'}
          >
            {autoRefresh ? <Pause size={12}/> : <Play size={12}/>}
            {autoRefresh ? 'Авто' : 'Авто'}
          </button>
          <span className={`text-xs mono hidden sm:block ${txtSecondary}`}>{lastUpdate.toLocaleTimeString('ru')}</span>
          <button onClick={loadAll} disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs hover:bg-slate-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''}/> Обновить
          </button>
        </div>
      </header>

      {/* Вкладки */}
      <div className="flex gap-1 border-b border-white/5">
        {([['dashboard','Дашборд'],['compare','Сравнение'],['sessions','Сессии ТСД']] as [Tab,string][]).map(([t,label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-blue-500 text-blue-400'
                : `border-transparent ${txtSecondary} hover:text-slate-300`
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'compare' && <CompareView/>}

      {tab === 'sessions' && <SessionsView dateFrom={filters.dateFrom} dateTo={filters.dateTo}/>}

      {tab === 'dashboard' && (
        <>
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
            <h2 className={`text-sm font-semibold uppercase tracking-widest mb-3 ${txtSecondary}`}>Live поток</h2>
            <LiveFeed/>
          </div>

          <div>
            <h2 className={`text-sm font-semibold uppercase tracking-widest mb-3 ${txtSecondary}`}>Лента событий</h2>
            <ErrorFeed dateFrom={filters.dateFrom} dateTo={filters.dateTo}
              initLevel={filters.level} initDatabase={filters.database} initSearch={filters.search}
              onFilterChange={f => setFilters(prev => ({...prev,...f}))}/>
          </div>
        </>
      )}

      <footer className={`text-center text-xs mono pb-2 ${dark ? 'text-slate-700' : 'text-slate-400'}`}>
        WMS Monitor · React + FastAPI + PostgreSQL
      </footer>
    </div>
  )
}

export default function App() {
  return <ToastProvider><Dashboard/></ToastProvider>
}
