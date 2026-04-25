import { useState } from 'react'
import { FolderSearch } from 'lucide-react'
import { BASE } from '../api/client'

interface FileInfo { file: string; ingested: boolean; entries: number }

export function RescanButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{new_files: {file:string;entries:number}[]} | null>(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [open, setOpen] = useState(false)

  const rescan = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${BASE}/api/admin/rescan`, { method: 'POST' })
      const data = await r.json()
      setResult(data)
      const f = await fetch(`${BASE}/api/admin/files`)
      setFiles(await f.json())
      setOpen(true)
    } finally { setLoading(false) }
  }

  return (
    <>
      <button
        onClick={rescan}
        disabled={loading}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs hover:bg-slate-700 transition-colors disabled:opacity-50 border border-white/5"
        title="Проверить новые лог-файлы"
      >
        <FolderSearch size={12} className={loading ? 'animate-pulse' : ''} />
        {loading ? 'Сканирование...' : 'Rescan'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl p-5 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-200">Файлы логов</h3>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-200 text-lg">✕</button>
            </div>
            {result && result.new_files.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 mono">
                ✅ Загружено новых файлов: {result.new_files.length} ({result.new_files.reduce((a,f) => a + f.entries, 0).toLocaleString()} записей)
              </div>
            )}
            {result && result.new_files.length === 0 && (
              <div className="mb-4 p-3 rounded-lg bg-slate-800 text-xs text-slate-400 mono">
                Новых файлов не найдено
              </div>
            )}
            <div className="overflow-auto max-h-64">
              <table className="w-full text-xs mono border-collapse">
                <thead>
                  <tr className="text-slate-500 border-b border-white/5">
                    <th className="text-left py-2 px-3 font-normal">Файл</th>
                    <th className="text-right py-2 px-3 font-normal">Статус</th>
                    <th className="text-right py-2 px-3 font-normal">Записей</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map(f => (
                    <tr key={f.file} className="border-b border-white/[0.03]">
                      <td className="py-1.5 px-3 text-slate-300">{f.file}</td>
                      <td className="py-1.5 px-3 text-right">
                        <span className={f.ingested ? 'text-emerald-400' : 'text-orange-400'}>
                          {f.ingested ? '✓ загружен' : '⚠ новый'}
                        </span>
                      </td>
                      <td className="py-1.5 px-3 text-right text-slate-400">{f.entries.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
