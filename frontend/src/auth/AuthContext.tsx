import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, onUnauthorized, tokens } from '../api/client'
import type { AuthResponse, User } from '../api/types'
import { AuthContext, type AuthState } from './context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => Boolean(tokens.get()))

  const logout = useCallback(() => {
    tokens.set(null)
    setUser(null)
    qc.clear()
  }, [qc])

  useEffect(() => {
    onUnauthorized.handler = logout
    if (!tokens.get()) return
    api<User>('/auth/me/')
      .then(setUser)
      .catch(() => logout())
      .finally(() => setLoading(false))
  }, [logout])

  const accept = useCallback(
    (res: AuthResponse) => {
      qc.clear()
      tokens.set({ access: res.access, refresh: res.refresh })
      setUser(res.user)
      return res.user
    },
    [qc],
  )

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      logout,
      login: (email, password) =>
        api<AuthResponse>('/auth/login/', { method: 'POST', json: { username: email, password } }).then(accept),
      register: (data) => api<AuthResponse>('/auth/register/', { method: 'POST', json: data }).then(accept),
      demoLogin: (role) => api<AuthResponse>('/auth/demo-login/', { method: 'POST', json: { role } }).then(accept),
    }),
    [user, loading, logout, accept],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
