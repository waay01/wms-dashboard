import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts'
import { fetchLogs } from '../api/client'
interface DrillItem { id:number; timestamp:string; database:string; level_eng:string; msg:string; operator_name:string|null }
export function TopErrors({ data, dateFrom, dateTo }: { data:{msg:string;count:number}[]; dateFrom?:string; dateTo?:string }) {
  const [drill, setDrill] = useState<{msg:string;items:DrillItem[];total:number}|null>(null)
  const openDrill = async (msg: string) => {
    const d = await fetchLogs({search:msg.slice(0,40),level:'ERROR',date_from:dateFrom,date_to:dateTo,limit:50})
    setDrill({msg,items:d.items,total:d.total})
  }
  return (
    <>
      <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">Топ ошибок</h3>
        {data.length===0 ? <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div> : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} layout="vertical" margin={{top:0,right:10,left:0,bottom:0}} onClick={e=>e?.activePayload&&openDrill(e.activePayload[0]?.payload?.msg)}>
              <XAxis type="number" tick={{fontSize:10,fill:'#475569',fontFamily:'JetBrains Mono'}}/>
              <YAxis type="category" dataKey="msg" width={120} tick={{fontSize:9,fill:'#94a3b8',fontFamily:'JetBrains Mono'}} tickFormatter={v=>v?.length>22?v.slice(0,22)+'…':v}/>
              <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:11 }} itemStyle={{color: '#22c55e'}}/>
              <Bar dataKey="count" radius={[0,4,4,0]} style={{cursor:'pointer'}}>{data.map((_,i)=><Cell key={i} fill={`hsl(${i*15},80%,55%)`}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="text-xs text-slate-600 mono mt-2 text-center">↑ кликни на строку для подробностей</p>
      </div>
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={()=>setDrill(null)}/>
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div><p className="text-xs text-red-400 mono uppercase tracking-widest mb-1">Drill-down · {drill.total.toLocaleString()} вхождений</p><p className="text-sm text-slate-200 font-medium">{drill.msg}</p></div>
              <button onClick={()=>setDrill(null)} className="text-slate-500 hover:text-slate-200 text-lg">✕</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs mono border-collapse">
                <thead><tr className="text-slate-500 border-b border-white/5"><th className="text-left py-2 px-3 font-normal">Время</th><th className="text-left py-2 px-3 font-normal">БД</th><th className="text-left py-2 px-3 font-normal">Оператор</th><th className="text-left py-2 px-3 font-normal">Сообщение</th></tr></thead>
                <tbody>{drill.items.map(item=>(
                  <tr key={item.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">{new Date(item.timestamp).toLocaleString('ru')}</td>
                    <td className="py-1.5 px-3 text-slate-400">{item.database}</td>
                    <td className="py-1.5 px-3 text-emerald-400">{item.operator_name||'—'}</td>
                    <td className="py-1.5 px-3 text-slate-300 max-w-xs " title={item.msg}>{item.msg}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
const DB_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f97316','#ef4444','#06b6d4']
export function DatabasesChart({ data }: { data:{database:string;count:number}[] }) {
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">По базам данных</h3>
      {data.length===0 ? <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div> : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="database" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>{data.map((_,i)=><Cell key={i} fill={DB_COLORS[i%DB_COLORS.length]}/>)}</Pie>
            <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:11}}/>
            <Legend wrapperStyle={{fontSize:10,fontFamily:'JetBrains Mono'}}/>
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
