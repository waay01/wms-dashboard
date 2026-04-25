import { Sun, Moon } from 'lucide-react'
export function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors bg-slate-800/60 border-white/5 text-slate-400 hover:bg-slate-700 hover:text-slate-200">
      {dark ? <Sun size={13}/> : <Moon size={13}/>}
      {dark ? 'Светлая' : 'Тёмная'}
    </button>
  )
}
