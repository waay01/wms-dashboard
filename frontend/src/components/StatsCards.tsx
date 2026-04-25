import { AlertTriangle, Activity, Database, Monitor } from 'lucide-react'

interface Stats {
  total: number
  errors: number
  warnings: number
  tsd_events: number
  errors_24h: number
}

const cards = [
  { key: 'total', label: 'Всего записей', icon: Activity, color: 'from-blue-900/40 to-blue-800/20', accent: '#3b82f6' },
  { key: 'errors', label: 'Ошибок всего', icon: AlertTriangle, color: 'from-red-900/40 to-red-800/20', accent: '#ef4444' },
  { key: 'errors_24h', label: 'Ошибок за 24ч', icon: AlertTriangle, color: 'from-orange-900/40 to-orange-800/20', accent: '#f97316' },
  { key: 'tsd_events', label: 'Событий ТСД', icon: Monitor, color: 'from-emerald-900/40 to-emerald-800/20', accent: '#10b981' },
]

export function StatsCards({ stats }: { stats: Stats | null }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ key, label, icon: Icon, color, accent }) => (
        <div key={key} className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${color} border border-white/5 p-4`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">{label}</p>
              <p className="text-3xl font-bold mono" style={{ color: accent }}>
                {stats ? (stats[key as keyof Stats] ?? 0).toLocaleString() : '—'}
              </p>
            </div>
            <Icon size={20} style={{ color: accent }} className="opacity-60 mt-1" />
          </div>
          <div className="absolute bottom-0 left-0 h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${accent}40, transparent)` }} />
        </div>
      ))}
    </div>
  )
}
