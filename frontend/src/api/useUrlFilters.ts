import { useState, useCallback } from 'react'
export interface Filters { dateFrom: string; dateTo: string; level: string; database: string; search: string }
const DEFAULT: Filters = { dateFrom: '', dateTo: '', level: '', database: '', search: '' }
function toUrl(f: Filters) { const p = new URLSearchParams(); Object.entries(f).forEach(([k,v]) => { if (v) p.set(k,v) }); return p }
function fromUrl(): Filters { const p = new URLSearchParams(window.location.search); return { dateFrom: p.get('dateFrom')||'', dateTo: p.get('dateTo')||'', level: p.get('level')||'', database: p.get('database')||'', search: p.get('search')||'' } }
export function useUrlFilters() {
  const [filters, setFiltersState] = useState<Filters>(fromUrl)
  const setFilters = useCallback((f: Filters | ((p: Filters) => Filters)) => {
    setFiltersState(prev => {
      const next = typeof f === 'function' ? f(prev) : f
      const params = toUrl(next)
      window.history.replaceState(null, '', params.toString() ? `?${params}` : window.location.pathname)
      return next
    })
  }, [])
  return { filters, setFilters, reset: useCallback(() => setFilters(DEFAULT), []) }
}
