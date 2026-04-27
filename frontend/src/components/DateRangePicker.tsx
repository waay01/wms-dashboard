import { useState } from 'react'
import { Calendar, ChevronDown, X } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  dateFrom: string
  dateTo: string
  onChange: (f: string, t: string) => void
  minDate?: string
  maxDate?: string
}

const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

const PRESETS = [
  { label: 'Сегодня', fn: () => [`${today()}T00:00:00`, `${today()}T23:59:59`] },
  { label: 'Вчера', fn: () => [`${daysAgo(1)}T00:00:00`, `${daysAgo(1)}T23:59:59`] },
  { label: '7 дней', fn: () => [`${daysAgo(6)}T00:00:00`, `${today()}T23:59:59`] },
  { label: '30 дней', fn: () => [`${daysAgo(29)}T00:00:00`, `${today()}T23:59:59`] },
  { label: 'Всё время', fn: () => ['', ''] },
]

function splitDT(v: string) {
  if (!v) return ['', '']
  if (v.includes('T')) return v.split('T')
  return [v, '']
}

export function DateRangePicker({ dateFrom, dateTo, onChange, minDate, maxDate }: Props) {
  const [open, setOpen] = useState(false)
  const hasValue = !!(dateFrom || dateTo)

  const [fromDate, fromTime] = splitDT(dateFrom)
  const [toDate, toTime] = splitDT(dateTo)

  const build = (date: string, time: string) => date ? (time ? `${date}T${time}` : `${date}T00:00:00`) : ''
  const buildTo = (date: string, time: string) => date ? (time ? `${date}T${time}` : `${date}T23:59:59`) : ''

  const label = hasValue
    ? `${fromDate || '...'} ${fromTime || '00:00'} → ${toDate || '...'} ${toTime || '23:59'}`
    : 'Все даты'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors',
          hasValue ? 'bg-blue-500/20 border-blue-500/30 text-blue-300' : 'bg-slate-800/60 border-white/5 text-slate-300')}
      >
        <Calendar size={14} />
        <span className="mono text-xs">{label}</span>
        {hasValue
          ? <X size={13} className="ml-1 opacity-60 hover:opacity-100" onClick={e => { e.stopPropagation(); onChange('', '') }} />
          : <ChevronDown size={13} className="opacity-60" />}
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 z-40 bg-slate-900 border border-white/10 rounded-xl shadow-2xl p-4 min-w-[320px]">
          <div className="flex flex-wrap gap-1.5 mb-4">
            {PRESETS.map(p => (
              <button key={p.label}
                onClick={() => { const [f, t] = p.fn(); onChange(f, t); setOpen(false) }}
                className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-white/5">
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <label className="text-xs text-slate-500 uppercase tracking-widest">От</label>
            <div className="flex gap-2">
              <input type="date" value={fromDate}
                min={minDate?.split('T')[0]} max={maxDate?.split('T')[0]}
                onChange={e => onChange(build(e.target.value, fromTime), buildTo(toDate, toTime))}
                className="flex-1 bg-slate-800 border border-white/5 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none focus:border-blue-500/50" />
              <input type="time" value={fromTime || '00:00'}
                onChange={e => onChange(build(fromDate, e.target.value), buildTo(toDate, toTime))}
                className="w-24 bg-slate-800 border border-white/5 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none focus:border-blue-500/50" />
            </div>

            <label className="text-xs text-slate-500 uppercase tracking-widest">До</label>
            <div className="flex gap-2">
              <input type="date" value={toDate}
                min={minDate?.split('T')[0]} max={maxDate?.split('T')[0]}
                onChange={e => onChange(build(fromDate, fromTime), buildTo(e.target.value, toTime))}
                className="flex-1 bg-slate-800 border border-white/5 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none focus:border-blue-500/50" />
              <input type="time" value={toTime || '23:59'}
                onChange={e => onChange(build(fromDate, fromTime), buildTo(toDate, e.target.value))}
                className="w-24 bg-slate-800 border border-white/5 rounded-lg px-2 py-1.5 text-xs mono text-slate-200 focus:outline-none focus:border-blue-500/50" />
            </div>

            <button onClick={() => setOpen(false)}
              className="w-full py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors">
              Применить
            </button>
          </div>
        </div>
      )}
      {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
    </div>
  )
}
