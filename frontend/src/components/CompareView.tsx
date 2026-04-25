import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis } from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { BASE } from '../api/client'

interface Metrics {
  from: string; to: string
  total: number; errors: number; warnings: number
  tsd: number; integration: number; databases: number; operators: number
  top_errors: {msg: string; count: number}[]
  by_level: {level: string; count: number}[]
}

interface CompareResult { period_a: Metrics; period_b: Metrics }

function today() { return new Date().toISOString().slice(0,10) }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10) }

const PRESETS = [
  { label: 'Сегодня vs Вчера', a: [today(), today()], b: [daysAgo(1), daysAgo(1)] },
  { label: 'Эта неделя vs Прошлая', a: [daysAgo(6), today()], b: [daysAgo(13), daysAgo(7)] },
]

function Delta({ a, b, inverse = false }: { a: number; b: number; inverse?: boolean }) {
  if (b === 0) return <span className="text-slate-500 text-xs">—</span>
  const pct = Math.round(((a - b) / b) * 100)
  const better = inverse ? pct < 0 : pct > 0
  const color = pct === 0 ? 'text-slate-400' : better ? 'text-emerald-400' : 'text-red-400'
  const Icon = pct === 0 ? Minus : pct > 0 ? TrendingUp : TrendingDown
  return (
    <span className={`flex items-center gap-1 text-xs ${color}`}>
      <Icon size={11}/>{Math.abs(pct)}%
    </span>
  )
}

const METRICS = [
  { key: 'total', label: 'Всего записей', inverse: false },
  { key: 'errors', label: 'Ошибок', inverse: true },
  { key: 'warnings', label: 'Предупреждений', inverse: true },
  { key: 'integration', label: 'Ошибок интеграции', inverse: true },
  { key: 'tsd', label: 'Событий ТСД', inverse: false },
  { key: 'operators', label: 'Операторов', inverse: false },
]

export function CompareView() {
  const [fromA, setFromA] = useState(daysAgo(1))
  const [toA, setToA] = useState(daysAgo(1))
  const [fromB, setFromB] = useState(daysAgo(2))
  const [toB, setToB] = useState(daysAgo(2))
  const [result, setResult] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(false)

  const run = async (fa=fromA, ta=toA, fb=fromB, tb=toB) => {
    setLoading(true)
    try {
      const r = await fetch(`${BASE}/api/compare?date_from_a=${fa}&date_to_a=${ta}&date_from_b=${fb}&date_to_b=${tb}`)
      setResult(await r.json())
    } finally { setLoading(false) }
  }

  const barData = result ? METRICS.map(m => ({
    name: m.label,
    'Период А': result.period_a[m.key as keyof Metrics] as number,
    'Период Б': result.period_b[m.key as keyof Metrics] as number,
  })) : []

  const topData = result ? result.period_a.top_errors.map((e, i) => ({
    msg: e.msg.slice(0,30) + '…',
    'Период А': e.count,
    'Период Б': result.period_b.top_errors[i]?.count || 0,
  })) : []

  return (
    <div className="flex flex-col gap-4">
      {/* Настройка периодов */}
      <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">Сравнение периодов</h3>

        {/* Пресеты */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {PRESETS.map(p => (
            <button key={p.label}
              onClick={() => { setFromA(p.a[0]); setToA(p.a[1]); setFromB(p.b[0]); setToB(p.b[1]); run(p.a[0],p.a[1],p.b[0],p.b[1]) }}
              className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/5 transition-colors">
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-blue-400 uppercase tracking-widest mono">Период А</label>
            <div className="flex gap-2">
              <input type="date" value={fromA} onChange={e=>setFromA(e.target.value)}
                className="flex-1 bg-slate-800 border border-blue-500/30 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none"/>
              <span className="text-slate-600 text-xs self-center">→</span>
              <input type="date" value={toA} onChange={e=>setToA(e.target.value)}
                className="flex-1 bg-slate-800 border border-blue-500/30 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none"/>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-purple-400 uppercase tracking-widest mono">Период Б</label>
            <div className="flex gap-2">
              <input type="date" value={fromB} onChange={e=>setFromB(e.target.value)}
                className="flex-1 bg-slate-800 border border-purple-500/30 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none"/>
              <span className="text-slate-600 text-xs self-center">→</span>
              <input type="date" value={toB} onChange={e=>setToB(e.target.value)}
                className="flex-1 bg-slate-800 border border-purple-500/30 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none"/>
            </div>
          </div>
        </div>

        <button onClick={() => run()} disabled={loading}
          className="mt-4 px-6 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50">
          {loading ? 'Сравниваю...' : 'Сравнить'}
        </button>
      </div>

      {result && (
        <>
          {/* Метрики */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {METRICS.map(m => {
              const va = result.period_a[m.key as keyof Metrics] as number
              const vb = result.period_b[m.key as keyof Metrics] as number
              return (
                <div key={m.key} className="rounded-xl bg-slate-900/60 border border-white/5 p-3">
                  <p className="text-xs text-slate-500 mb-2 leading-tight">{m.label}</p>
                  <div className="flex items-end justify-between gap-1">
                    <div>
                      <p className="text-lg font-bold mono text-blue-400">{va.toLocaleString()}</p>
                      <p className="text-xs mono text-purple-400">{vb.toLocaleString()}</p>
                    </div>
                    <Delta a={va} b={vb} inverse={m.inverse}/>
                  </div>
                </div>
              )
            })}
          </div>

          {/* График метрик */}
          <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
            <h4 className="text-xs text-slate-400 uppercase tracking-widest mb-4">Сравнение метрик</h4>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} margin={{top:0,right:10,left:-10,bottom:0}}>
                <XAxis dataKey="name" tick={{fontSize:9,fill:'#475569',fontFamily:'JetBrains Mono'}} tickFormatter={v=>v.slice(0,12)}/>
                <YAxis tick={{fontSize:9,fill:'#475569',fontFamily:'JetBrains Mono'}}/>
                <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:11}}/>
                <Legend wrapperStyle={{fontSize:10,fontFamily:'JetBrains Mono'}}/>
                <Bar dataKey="Период А" fill="#3b82f6" radius={[4,4,0,0]}/>
                <Bar dataKey="Период Б" fill="#8b5cf6" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Топ ошибок сравнение */}
          {topData.length > 0 && (
            <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
              <h4 className="text-xs text-slate-400 uppercase tracking-widest mb-4">Топ ошибок — сравнение</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={topData} layout="vertical" margin={{top:0,right:10,left:10,bottom:0}}>
                  <XAxis type="number" tick={{fontSize:9,fill:'#475569',fontFamily:'JetBrains Mono'}}/>
                  <YAxis type="category" dataKey="msg" width={140} tick={{fontSize:9,fill:'#94a3b8',fontFamily:'JetBrains Mono'}}/>
                  <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:11}}/>
                  <Legend wrapperStyle={{fontSize:10,fontFamily:'JetBrains Mono'}}/>
                  <Bar dataKey="Период А" fill="#3b82f6" radius={[0,4,4,0]}/>
                  <Bar dataKey="Период Б" fill="#8b5cf6" radius={[0,4,4,0]}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Уровни логов */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(['period_a','period_b'] as const).map((pk, i) => (
              <div key={pk} className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
                <h4 className="text-xs uppercase tracking-widest mb-3" style={{color: i===0?'#3b82f6':'#8b5cf6'}}>
                  Период {i===0?'А':'Б'} — по уровням
                </h4>
                <div className="flex flex-col gap-1.5">
                  {result[pk].by_level.map(l => {
                    const pct = result[pk].total > 0 ? (l.count/result[pk].total*100).toFixed(1) : '0'
                    const colors: Record<string,string> = {ERROR:'#ef4444',WARN:'#f97316',INFO:'#3b82f6',DEBUG:'#6b7280'}
                    return (
                      <div key={l.level} className="flex items-center gap-2">
                        <span className="text-xs mono w-16 text-slate-400">{l.level}</span>
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{width:`${pct}%`,background:colors[l.level]||'#94a3b8'}}/>
                        </div>
                        <span className="text-xs mono text-slate-400 w-12 text-right">{Number(pct)}%</span>
                        <span className="text-xs mono text-slate-500 w-16 text-right">{l.count.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
