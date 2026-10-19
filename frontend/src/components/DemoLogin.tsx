import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Role } from '../api/types'
import { homeFor, useAuth } from '../auth/context'
import { Button, ErrorMessage } from './ui'

const roles: { role: Role; label: string; hint: string }[] = [
  { role: 'customer', label: 'Customer', hint: 'Book and manage visits' },
  { role: 'staff', label: 'Staff', hint: "Run today's schedule" },
  { role: 'admin', label: 'Owner', hint: 'See the whole business' },
]

/** One-click logins into seeded accounts. `next` keeps the visitor where they were (e.g. mid-booking). */
export function DemoLogin({ next, compact = false }: { next?: string; compact?: boolean }) {
  const { demoLogin } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState<Role | null>(null)
  const [error, setError] = useState<unknown>(null)

  async function go(role: Role) {
    setPending(role)
    setError(null)
    try {
      const user = await demoLogin(role)
      navigate(next && user.role === 'customer' ? next : homeFor(user.role))
    } catch (err) {
      setError(err)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'sm:grid-cols-3'}`}>
        {(compact ? roles.filter((r) => r.role === 'customer') : roles).map(({ role, label, hint }) => (
          <Button
            key={role}
            variant={role === 'customer' ? 'primary' : 'secondary'}
            className="h-auto flex-col items-start! py-3 text-left"
            loading={pending === role}
            disabled={pending !== null}
            onClick={() => go(role)}
          >
            <span>{compact ? 'Continue as demo customer' : `Try as ${label}`}</span>
            <span className="text-xs font-normal opacity-80">{hint}</span>
          </Button>
        ))}
      </div>
      <ErrorMessage error={error} />
    </div>
  )
}
