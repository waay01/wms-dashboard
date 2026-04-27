import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts'
import { Users } from 'lucide-react'
import { fetchOperators } from '../api/client'

interface Props { dateFrom: string; dateTo: string }
interface Op { operator: string; operations: number; errors: number }

export function OperatorsChart({ dateFrom, dateTo }: Props) {
  const [data, setData] = useState<Op[]>([])

  useEffect(() => {
    fetchOperators({ date_from: dateFrom, date_to: dateTo })
      .then(setData)
      .catch(err => console.error('Failed to load operators:', err))
  }, [dateFrom, dateTo])

  // Вычисляем нужную ширину для самого длинного имени
  const maxNameLen = data.reduce((max, d) => Math.max(max, (d.operator || '').length), 0)
  const yAxisWidth = Math.min(Math.max(maxNameLen * 7, 80), 180)

  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Users size={15} className="text-emerald-400"/>
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">
          Активность операторов ТСД
        </h3>
      </div>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, data.length * 28)}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
          >
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: '#475569', fontFamily: 'JetBrains Mono' }}
            />
            <YAxis
              type="category"
              dataKey="operator"
              width={yAxisWidth}
              tick={{ fontSize: 10, fill: '#94a3b8', fontFamily: 'JetBrains Mono' }}
            />
            <Tooltip
              contentStyle={{
                background: '#0f172a',
                border: '1px solid #1e3a5f',
                borderRadius: 8,
                fontFamily: 'JetBrains Mono',
                fontSize: 11
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}/>
            <Bar dataKey="operations" name="Операции" fill="#10b981" radius={[0, 4, 4, 0]}/>
            <Bar dataKey="errors" name="Ошибки" fill="#ef4444" radius={[0, 4, 4, 0]}/>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
