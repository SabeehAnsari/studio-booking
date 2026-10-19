import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { AppointmentStatus } from '../api/types'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-ink hover:bg-brand-hover',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-ink-muted',
  ghost: 'text-ink-soft hover:text-ink hover:bg-line/60',
  danger: 'bg-surface text-bad border border-line-strong hover:border-bad',
  destructive: 'bg-bad text-canvas hover:opacity-90',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  const sizing = size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm'
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizing} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  )
}

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-12 text-ink-muted" role="status">
      <Spinner /> {label}
    </div>
  )
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">
      {message}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-ink-soft">{children}</div>}
    </div>
  )
}

const statusStyles: Record<AppointmentStatus, { label: string; className: string; icon: string }> = {
  pending: { label: 'Pending', className: 'bg-warn-soft text-warn', icon: '◷' },
  confirmed: { label: 'Confirmed', className: 'bg-brand-soft text-brand', icon: '✓' },
  completed: { label: 'Completed', className: 'bg-good-soft text-good', icon: '✓' },
  cancelled: { label: 'Cancelled', className: 'bg-line text-ink-muted', icon: '✕' },
  no_show: { label: 'No-show', className: 'bg-bad-soft text-bad', icon: '!' },
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { label, className, icon } = statusStyles[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  )
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {error && <span className="mt-1 block text-sm text-bad">{error}</span>}
    </label>
  )
}

export const inputClass =
  'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none'

export const selectClass =
  'h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus:border-brand focus:outline-none'
