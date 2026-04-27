import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react'
import { AlertTriangle, X, CheckCircle, Info } from 'lucide-react'
import clsx from 'clsx'
type ToastType = 'error'|'warn'|'info'|'success'
interface Toast { id: number; type: ToastType; title: string; msg?: string }
interface ToastCtx { push: (t: Omit<Toast,'id'>) => void }
const Ctx = createContext<ToastCtx>({ push: () => {} })
export function useToast() { return useContext(Ctx) }
const ICONS = { error: AlertTriangle, warn: AlertTriangle, info: Info, success: CheckCircle }
const STYLES = { error: 'border-red-500/40 bg-red-950/80', warn: 'border-orange-500/40 bg-orange-950/80', info: 'border-blue-500/40 bg-blue-950/80', success: 'border-emerald-500/40 bg-emerald-950/80' }
const ICON_STYLES = { error: 'text-red-400', warn: 'text-orange-400', info: 'text-blue-400', success: 'text-emerald-400' }
let _id = 0
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const push = useCallback((t: Omit<Toast,'id'>) => {
    const id = ++_id
    setToasts(p => [...p, {...t, id}])
    const timer = setTimeout(() => {
      setToasts(p => p.filter(x => x.id !== id))
      timersRef.current.delete(id)
    }, 5000)
    timersRef.current.set(id, timer)
  }, [])
  useEffect(() => {
    const timers = timersRef.current
    return () => { timers.forEach(t => clearTimeout(t)); timers.clear() }
  }, [])
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map(t => { const Icon = ICONS[t.type]; return (
          <div key={t.id} className={clsx('flex items-start gap-3 rounded-xl border px-4 py-3 backdrop-blur-sm shadow-xl animate-in', STYLES[t.type])}>
            <Icon size={16} className={clsx('mt-0.5 shrink-0', ICON_STYLES[t.type])} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-100">{t.title}</p>
              {t.msg && <p className="text-xs text-slate-400 mono mt-0.5 truncate">{t.msg}</p>}
            </div>
            <button onClick={() => setToasts(p => p.filter(x => x.id !== t.id))} className="text-slate-500 hover:text-slate-300"><X size={14}/></button>
          </div>
        )})}
      </div>
    </Ctx.Provider>
  )
}
