import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
const LEVEL_COLORS: Record<string,string> = { ERROR:'#ef4444', WARN:'#f97316', INFO:'#3b82f6', DEBUG:'#6b7280', UNKNOWN:'#8b5cf6' }
export function ActivityChart({ data }: { data: Record<string,number|string>[] }) {
  const levels = data.length ? Object.keys(data[0]).filter(k=>k!=='time') : []
  return (
    <div className="rounded-xl bg-slate-900/60 border border-white/5 p-4">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-4">Активность по уровням</h3>
      {data.length===0 ? <div className="h-48 flex items-center justify-center text-slate-500 mono text-sm">нет данных</div> : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{top:5,right:10,left:-20,bottom:5}}>
            <defs>{levels.map(l=><linearGradient key={l} id={`grad-${l}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={LEVEL_COLORS[l]||'#94a3b8'} stopOpacity={0.3}/><stop offset="95%" stopColor={LEVEL_COLORS[l]||'#94a3b8'} stopOpacity={0}/></linearGradient>)}</defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
            <XAxis dataKey="time" tick={{fontSize:10,fill:'#475569',fontFamily:'JetBrains Mono'}} tickFormatter={v=>v?new Date(v).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'}):''}/>
            <YAxis tick={{fontSize:10,fill:'#475569',fontFamily:'JetBrains Mono'}}/>
            <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #1e3a5f',borderRadius:8,fontFamily:'JetBrains Mono',fontSize:12}} labelFormatter={v=>new Date(v).toLocaleString('ru')}/>
            <Legend wrapperStyle={{fontSize:11,fontFamily:'JetBrains Mono'}}/>
            {levels.map(l=><Area key={l} type="monotone" dataKey={l} stroke={LEVEL_COLORS[l]||'#94a3b8'} fill={`url(#grad-${l})`} strokeWidth={1.5}/>)}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
