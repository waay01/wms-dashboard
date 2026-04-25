const BASE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : `http://${window.location.hostname}:8000`
export { BASE }
function qs(p: Record<string, any>) {
  const q = new URLSearchParams()
  Object.entries(p).forEach(([k,v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
  return q.toString() ? `?${q}` : ''
}
export async function fetchStats(p={}) { return (await fetch(`${BASE}/api/stats${qs(p)}`)).json() }
export async function fetchLogs(p: Record<string,any>={}) { return (await fetch(`${BASE}/api/logs${qs(p)}`)).json() }
export async function fetchActivityChart(p: Record<string,any>={}) { return (await fetch(`${BASE}/api/charts/activity${qs(p)}`)).json() }
export async function fetchDatabasesChart(p={}) { return (await fetch(`${BASE}/api/charts/databases${qs(p)}`)).json() }
export async function fetchTopErrors(p: Record<string,any>={}) { return (await fetch(`${BASE}/api/charts/top-errors${qs(p)}`)).json() }
export async function fetchFilterDatabases() { return (await fetch(`${BASE}/api/filters/databases`)).json() }
export async function fetchDateRange() { return (await fetch(`${BASE}/api/filters/date-range`)).json() }
export async function fetchIntegrationErrors(p: Record<string,any>={}) { return (await fetch(`${BASE}/api/integration-errors${qs(p)}`)).json() }
export async function fetchIntegrationSummary(p={}) { return (await fetch(`${BASE}/api/integration-errors/summary${qs(p)}`)).json() }
export async function fetchOperators(p={}) { return (await fetch(`${BASE}/api/operators${qs(p)}`)).json() }
export async function fetchWatchdog() { return (await fetch(`${BASE}/api/watchdog`)).json() }
export function exportUrl(p: Record<string,any>={}) { return `${BASE}/api/logs/export${qs(p)}` }
