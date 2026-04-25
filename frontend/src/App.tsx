import { useState, useEffect } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { StatsCards } from './components/StatsCards'
import { ActivityChart } from './components/ActivityChart'
import { TopErrors, DatabasesChart } from './components/Charts'
import { ErrorFeed } from './components/ErrorFeed'
import { fetchStats, fetchActivityChart, fetchDatabasesChart, fetchTopErrors } from './api/client'

export default function App() {
  const [stats, setStats] = useState(null)
  const [activity, setActivity] = useState([])
  const [databases, setDatabases] = useState([])
  const [topErrors, setTopErrors] = useState([])
  const [lastUpdate, setLastUpdate] = useState(new Date())
  const [refreshing, setRefreshing] = useState(false)

  const loadAll = async () => {
    setRefreshing(true)
    try {
      const [s, a, d, e] = await Promise.all([
        fetchStats(),
        fetchActivityChart('hour'),
        fetchDatabasesChart(),
        fetchTopErrors(),
      ])
      setStats(s)
      setActivity(a)
      setDatabases(d)
      setTopErrors(e)
      setLastUpdate(new Date())
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadAll()
    const t = setInterval(loadAll, 30000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen p-4 lg:p-6 flex flex-col gap-4">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <Activity size={16} className="text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight" style={{ fontFamily: 'Syne' }}>
              WMS <span className="text-blue-400">Monitor</span>
            </h1>
            <p className="text-xs text-slate-500 mono">LEAD WMS · PostgreSQL logs</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 mono hidden sm:block">
            обновлено {lastUpdate.toLocaleTimeString('ru')}
          </span>
          <button
            onClick={loadAll}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Обновить
          </button>
        </div>
      </header>

      {/* Stats */}
      <StatsCards stats={stats} />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ActivityChart data={activity} />
        </div>
        <DatabasesChart data={databases} />
      </div>

      {/* Top errors */}
      <TopErrors data={topErrors} />

      {/* Log feed */}
      <div>
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-3">
          Лента событий
        </h2>
        <ErrorFeed />
      </div>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-600 mono pb-2">
        WMS Monitor · React + FastAPI + PostgreSQL
      </footer>
    </div>
  )
}
