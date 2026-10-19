import { createContext, useContext } from 'react'
import type { Role, User } from '../api/types'

export interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (data: { email: string; password: string; first_name: string; last_name: string; phone?: string }) => Promise<User>
  demoLogin: (role: Role) => Promise<User>
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function homeFor(role: Role) {
  return role === 'admin' ? '/admin' : role === 'staff' ? '/schedule' : '/appointments'
}
