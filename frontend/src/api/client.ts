import type { AuthResponse } from './types'

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const STORAGE_KEY = 'booking.auth'

export class ApiError extends Error {
  status: number
  data: unknown

  constructor(status: number, data: unknown) {
    super(extractMessage(data) ?? `Request failed (${status})`)
    this.status = status
    this.data = data
  }
}

/** Turns DRF error payloads ({detail}, {field: [msg]}, [msg]) into one readable sentence. */
function extractMessage(data: unknown): string | null {
  if (!data) return null
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return extractMessage(data[0])
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>
    if ('detail' in record) return extractMessage(record.detail)
    const first = Object.values(record)[0]
    return extractMessage(first)
  }
  return null
}

type StoredAuth = Pick<AuthResponse, 'access' | 'refresh'>

export const tokens = {
  get(): StoredAuth | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as StoredAuth) : null
    } catch {
      return null
    }
  },
  set(value: StoredAuth | null) {
    try {
      if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* storage unavailable: the session just won't survive a reload */
    }
  },
}

let refreshing: Promise<boolean> | null = null

async function refreshAccess(): Promise<boolean> {
  const current = tokens.get()
  if (!current?.refresh) return false
  // Share one in-flight refresh between concurrent 401s.
  refreshing ??= fetch(`${API_URL}/api/auth/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: current.refresh }),
  })
    .then(async (res) => {
      if (!res.ok) return false
      const { access } = (await res.json()) as { access: string }
      tokens.set({ ...current, access })
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

export const onUnauthorized = { handler: () => {} }

export async function api<T>(path: string, options: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const { json, headers, ...rest } = options
  const auth = tokens.get()
  const res = await fetch(`${API_URL}/api${path}`, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth?.access ? { Authorization: `Bearer ${auth.access}` } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })

  if (res.status === 401 && auth?.access && retry) {
    if (await refreshAccess()) return api<T>(path, options, false)
    tokens.set(null)
    onUnauthorized.handler()
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}
