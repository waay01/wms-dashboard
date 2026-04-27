import { useState, useEffect } from 'react'
import { Zap } from 'lucide-react'
import { fetchIntegrationSummary, fetchIntegrationErrors } from '../api/client'
interface Props { dateFrom: string; dateTo: string }
interface Summary { msg: string; count: number; first_seen: string; last_seen: string }
interface LogItem { id: number; timestamp: string; msg: string; pid: number }
export function IntegrationErrors({ dateFrom, dateTo }: Props) {
  const [summary, setSummary] = useState<Summary[]>([])
  const [drill, setDrill] = useState<{msg:string;items:LogItem[];total:number}|null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    setLoading(true)
    fetchIntegrationSummary({date_from:dateFrom,date_to:dateTo})
      .then(setSummary)
      .catch(err => console.error('Failed to load integration summary:', err))
      .finally(()=>setLoading(false))
  }, [dateFrom,dateTo])
  const openDrill = async (msg: string) => {
    try {
      const data = await fetchIntegrationErrors({search:msg.slice(0,40),date_from:dateFrom,date_to:dateTo,limit:50})
      setDrill({msg,items:data.items,total:data.total})
    } catch (err) {
      console.error('Drill-down failed:', err)
    }
  }
  return (
    <div className="rounded-xl bg-slate-900/60 border border-orange-500/10 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Zap size={15} className="text-orange-400"/>
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">Ошибки интеграции ERP↔WMS</h3>
        <span className="ml-auto text-xs mono text-orange-400">{summary.reduce((a,s)=>a+s.count,0).toLocaleString()} всего</span>
      </div>
      {loading ? <div className="h-32 flex items-center justify-center text-slate-500 mono text-sm">загрузка...</div> : (
        <div className="overflow-auto max-h-64">
          <table className="w-full text-xs mono border-collapse">
            <thead><tr className="text-slate-500 border-b border-white/5"><th className="text-left py-2 px-3 font-normal">Тип ошибки</th><th className="text-right py-2 px-3 font-normal">Кол-во</th><th className="text-right py-2 px-3 font-normal">Последний раз</th></tr></thead>
            <tbody>{summary.map((s,i) => (
              <tr key={i} className="border-b border-white/[0.03] hover:bg-orange-500/5 cursor-pointer" onClick={()=>openDrill(s.msg)}>
                <td className="py-1.5 px-3 text-slate-300 max-w-xs truncate" title={s.msg}>{s.msg}</td>
                <td className="py-1.5 px-3 text-right text-orange-400 font-semibold">{s.count.toLocaleString()}</td>
                <td className="py-1.5 px-3 text-right text-slate-500 whitespace-nowrap">{new Date(s.last_seen).toLocaleString('ru',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={()=>setDrill(null)}/>
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-start justify-between mb-4 gap-4">
              <div><p className="text-xs text-orange-400 mono uppercase tracking-widest mb-1">Drill-down · {drill.total.toLocaleString()} вхождений</p><p className="text-sm text-slate-200 font-medium">{drill.msg}</p></div>
              <button onClick={()=>setDrill(null)} className="text-slate-500 hover:text-slate-200 text-lg">✕</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs mono border-collapse">
                <thead><tr className="text-slate-500 border-b border-white/5"><th className="text-left py-2 px-3 font-normal">Время</th><th className="text-left py-2 px-3 font-normal">PID</th><th className="text-left py-2 px-3 font-normal">Сообщение</th></tr></thead>
                <tbody>{drill.items.map(item => (
                  <tr key={item.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">{new Date(item.timestamp).toLocaleString('ru')}</td>
                    <td className="py-1.5 px-3 text-slate-500">{item.pid}</td>
                    <td className="py-1.5 px-3 text-slate-300 max-w-xs truncate" title={item.msg}>{item.msg}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
