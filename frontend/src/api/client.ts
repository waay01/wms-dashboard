const BASE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : `http://${window.location.hostname}:8000`

export async function fetchStats() {
  const r = await fetch(`${BASE}/api/stats`)
  return r.json()
}

export async function fetchLogs(params: {
  level?: string
  database?: string
  search?: string
  is_tsd?: boolean
  limit?: number
  offset?: number
}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') q.set(k, String(v))
  })
  const r = await fetch(`${BASE}/api/logs?${q}`)
  return r.json()
}

export async function fetchActivityChart(interval = 'hour') {
  const r = await fetch(`${BASE}/api/charts/activity?interval=${interval}`)
  return r.json()
}

export async function fetchDatabasesChart() {
  const r = await fetch(`${BASE}/api/charts/databases`)
  return r.json()
}

export async function fetchTopErrors() {
  const r = await fetch(`${BASE}/api/charts/top-errors`)
  return r.json()
}

export async function fetchLevelsChart() {
  const r = await fetch(`${BASE}/api/charts/levels`)
  return r.json()
}

export async function fetchFilterDatabases() {
  const r = await fetch(`${BASE}/api/filters/databases`)
  return r.json()
}
