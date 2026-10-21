import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useConfig } from '../api/hooks'
import type { Role } from '../api/types'
import { homeFor, useAuth } from '../auth/context'
import { ErrorMessage, Spinner } from '../components/ui'

const ROLES: Record<string, { role: Role; label: string }> = {
  customer: { role: 'customer', label: 'customer' },
  staff: { role: 'staff', label: 'staff member' },
  owner: { role: 'admin', label: 'business owner' },
  admin: { role: 'admin', label: 'business owner' },
}

/**
 * One-click links into the public demo: /demo/customer, /demo/staff, /demo/owner.
 * Made for READMEs and CVs, so a recruiter lands straight in the right view with no sign-up.
 */
export function DemoEntry() {
  const { role: param = '' } = useParams()
  const target = ROLES[param.toLowerCase()]
  const { data: config } = useConfig()
  const { demoLogin } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)
  const started = useRef(false)

  useEffect(() => {
    // Wait for config so we know demo mode is on; guard against React's double-run in dev.
    if (!target || !config?.demo_mode || started.current) return
    started.current = true
    demoLogin(target.role)
      .then((user) => navigate(homeFor(user.role), { replace: true }))
      .catch(setError)
  }, [target, config, demoLogin, navigate])

  if (!target || (config && !config.demo_mode)) return <Navigate to="/" replace />

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      {error ? (
        <>
          <ErrorMessage error={error} />
          <Link to="/" className="mt-6 inline-block text-sm font-medium text-brand hover:underline">
            Go to the home page
          </Link>
        </>
      ) : (
        <p className="flex items-center justify-center gap-3 text-ink-soft" role="status">
          <Spinner /> Opening the demo as a {target.label}…
        </p>
      )}
    </div>
  )
}
