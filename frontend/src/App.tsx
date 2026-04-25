import { useState, useEffect, useRef } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
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
      if (!prevWatchdog.current.has(item.msg)) {
        push({type:'error', title:'🚨 Новый тип ошибки', msg:item.msg})
        prevWatchdog.current.add(item.msg)
      }
    })
  }

  useEffect(() => {
    fetchDateRange().then(setDateRange)
    loadAll()
    checkWatchdog()
    const t1 = setInterval(loadAll, 30000)
    const t2 = setInterval(checkWatchdog, 60000)
    return () => { clearInterval(t1); clearInterval(t2) }
  }, [filters.dateFrom, filters.dateTo])

  return (
    <div className={`min-h-screen p-4 lg:p-6 flex flex-col gap-4 ${dark ? 'bg-[#080c12] text-slate-200' : 'bg-slate-100 text-slate-800'}`}>
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <Activity size={16} className="text-blue-400"/>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight" style={{fontFamily:'Syne'}}>WMS <span className="text-blue-400">Monitor</span></h1>
            <p className="text-xs text-slate-500 mono">LEAD WMS · PostgreSQL logs</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateRangePicker dateFrom={filters.dateFrom} dateTo={filters.dateTo} minDate={dateRange.min} maxDate={dateRange.max} onChange={(from,to) => setFilters(f => ({...f, dateFrom:from, dateTo:to}))}/>
          <ThemeToggle dark={dark} onToggle={() => setDark(d => !d)}/>
          <span className="text-xs text-slate-500 mono hidden sm:block">{lastUpdate.toLocaleTimeString('ru')}</span>
          <button onClick={loadAll} disabled={refreshing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs hover:bg-slate-700 transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''}/> Обновить
          </button>
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
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-3">Live поток</h2>
        <LiveFeed/>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-3">Лента событий</h2>
        <ErrorFeed dateFrom={filters.dateFrom} dateTo={filters.dateTo} initLevel={filters.level} initDatabase={filters.database} initSearch={filters.search} onFilterChange={f => setFilters(prev => ({...prev,...f}))}/>
      </div>

      <footer className="text-center text-xs text-slate-600 mono pb-2">WMS Monitor · React + FastAPI + PostgreSQL</footer>
    </div>
  )
}

export default function App() {
  return <ToastProvider><Dashboard/></ToastProvider>
}
