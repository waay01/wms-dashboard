const BASE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : `${window.location.protocol}//${window.location.hostname}:8000`
export { BASE }

function qs(p: Record<string, any>) {
  const q = new URLSearchParams()
  Object.entries(p).forEach(([k,v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
  return q.toString() ? `?${q}` : ''
}

async function api<T = any>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText} — ${url}`)
  return res.json()
}

export async function fetchStats(p={}) { return api(`${BASE}/api/stats${qs(p)}`) }
export async function fetchLogs(p: Record<string,any>={}) { return api(`${BASE}/api/logs${qs(p)}`) }
export async function fetchActivityChart(p: Record<string,any>={}) { return api(`${BASE}/api/charts/activity${qs(p)}`) }
export async function fetchDatabasesChart(p={}) { return api(`${BASE}/api/charts/databases${qs(p)}`) }
export async function fetchTopErrors(p: Record<string,any>={}) { return api(`${BASE}/api/charts/top-errors${qs(p)}`) }
export async function fetchFilterDatabases() { return api<string[]>(`${BASE}/api/filters/databases`) }
export async function fetchDateRange() { return api<{min?:string;max?:string}>(`${BASE}/api/filters/date-range`) }
export async function fetchIntegrationErrors(p: Record<string,any>={}) { return api(`${BASE}/api/integration-errors${qs(p)}`) }
export async function fetchIntegrationSummary(p={}) { return api(`${BASE}/api/integration-errors/summary${qs(p)}`) }
export async function fetchOperators(p={}) { return api(`${BASE}/api/operators${qs(p)}`) }
export async function fetchWatchdog() { return api<{msg:string;count:number}[]>(`${BASE}/api/watchdog`) }
export function exportUrl(p: Record<string,any>={}) { return `${BASE}/api/logs/export${qs(p)}` }
