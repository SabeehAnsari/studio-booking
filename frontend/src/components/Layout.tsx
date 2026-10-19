import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useConfig } from '../api/hooks'
import { useAuth } from '../auth/context'
import { Button } from './ui'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-soft text-brand' : 'text-ink-soft hover:text-ink'
  }`

export function Layout() {
  const { user, logout } = useAuth()
  const { data: config } = useConfig()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-dvh flex-col">
      {config?.demo_mode && user?.is_demo && (
        <div className="bg-ink px-4 py-1.5 text-center text-xs text-canvas">
          You're exploring a demo as <strong className="font-semibold">{user.full_name}</strong> ({user.role}). Data resets
          regularly.
        </div>
      )}
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="font-display text-xl font-semibold tracking-tight">
            {config?.business_name ?? 'Studio Booking'}
          </Link>
          <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
            <NavLink to="/book" className={navClass}>
              Book
            </NavLink>
            {user?.role === 'customer' && (
              <NavLink to="/appointments" className={navClass}>
                My appointments
              </NavLink>
            )}
            {user?.role === 'staff' && (
              <NavLink to="/schedule" className={navClass}>
                My schedule
              </NavLink>
            )}
            {user?.role === 'admin' && (
              <NavLink to="/admin" className={navClass}>
                Dashboard
              </NavLink>
            )}
            {user ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  logout()
                  navigate('/')
                }}
              >
                Log out
              </Button>
            ) : (
              <NavLink to="/login" className={navClass}>
                Log in
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-ink-muted">
        Built with React, Django REST Framework &amp; PostgreSQL.
      </footer>
    </div>
  )
}
