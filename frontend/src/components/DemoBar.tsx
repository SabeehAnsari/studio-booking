import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Role } from '../api/types'
import { homeFor, useAuth } from '../auth/context'
import { useToast } from '../lib/toast'

const ROLES: { role: Role; label: string }[] = [
  { role: 'customer', label: 'Customer' },
  { role: 'staff', label: 'Staff' },
  { role: 'admin', label: 'Owner' },
]

/** What's worth trying in each role, so a first-time visitor isn't left guessing. */
const HINTS: Record<Role, { text: string; to: string; cta: string }> = {
  customer: { text: 'Book a treatment and pay the deposit with the demo checkout, then reschedule or cancel it.', to: '/book', cta: 'Book now' },
  staff: { text: 'Run today’s schedule, or change your working hours and add time off.', to: '/availability', cta: 'Edit availability' },
  admin: { text: 'Check the dashboard, filter every booking, or edit any staff member’s hours.', to: '/availability', cta: 'Staff hours' },
}

/** Shown on top of every page while using a shared demo account. */
export function DemoBar() {
  const { user, demoLogin } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [switching, setSwitching] = useState<Role | null>(null)
  if (!user?.is_demo) return null
  const hint = HINTS[user.role]

  async function switchTo(role: Role) {
    setSwitching(role)
    try {
      const next = await demoLogin(role)
      navigate(homeFor(next.role))
    } catch {
      toast("Couldn't switch roles. Please try again.", 'info')
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div className="bg-ink px-4 py-2 text-xs text-canvas">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p>
          <span className="opacity-75">Demo as </span>
          <strong className="font-semibold">{user.full_name}</strong>
          <span className="opacity-75"> · </span>
          {hint.text}{' '}
          <Link to={hint.to} className="font-semibold underline underline-offset-2">
            {hint.cta}
          </Link>
        </p>
        <div className="flex items-center gap-1" role="group" aria-label="Switch demo role">
          <span className="mr-1 opacity-75">View as</span>
          {ROLES.map(({ role, label }) => {
            const current = user.role === role
            return (
              <button
                key={role}
                type="button"
                aria-pressed={current}
                disabled={current || switching !== null}
                onClick={() => switchTo(role)}
                className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
                  current ? 'bg-canvas text-ink' : 'hover:bg-canvas/15 disabled:opacity-60'
                }`}
              >
                {switching === role ? '…' : label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
