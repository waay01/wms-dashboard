import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts'

export function TopErrors({ data }: { data: { msg: string; count: number }[] }) {
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4 h-full">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">
        Топ ошибок
      </h3>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10, fill: '#475569', fontFamily: 'JetBrains Mono' }} />
            <YAxis type="category" dataKey="msg" width={160}
              tick={{ fontSize: 9, fill: '#94a3b8', fontFamily: 'JetBrains Mono' }}
              tickFormatter={v => v?.length > 22 ? v.slice(0, 22) + '…' : v}
            />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11 }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={`hsl(${0 + i * 15}, 80%, 55%)`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

const DB_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f97316', '#ef4444', '#06b6d4']

export function DatabasesChart({ data }: { data: { database: string; count: number }[] }) {
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">
        По базам данных
      </h3>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="database" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
              {data.map((_, i) => <Cell key={i} fill={DB_COLORS[i % DB_COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 8, fontFamily: 'JetBrains Mono', fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
