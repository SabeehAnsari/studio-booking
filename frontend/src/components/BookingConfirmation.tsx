import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AppConfig, Appointment } from '../api/types'
import { formatDateTime, formatPrice } from '../lib/dates'

export function BookingConfirmation({
  appointment,
  config,
  secondaryAction,
}: {
  appointment: Appointment
  config: AppConfig
  secondaryAction: ReactNode
}) {
  const paid = appointment.payment?.status === 'paid' ? Number(appointment.payment.amount) : 0
  const balance = Number(appointment.price) - paid

  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="mx-auto mb-6 grid size-14 place-items-center rounded-full bg-good-soft text-2xl text-good" aria-hidden="true">
        ✓
      </div>
      <h1 className="font-display text-3xl font-semibold tracking-tight">You're booked in</h1>
      <p className="mt-2 text-ink-soft">
        {appointment.service.name} with {appointment.staff.name}
        <br />
        <strong className="text-ink">{formatDateTime(appointment.start, config.timezone)}</strong>
      </p>

      {paid > 0 && (
        <dl className="mx-auto mt-6 max-w-xs space-y-2 rounded-xl border border-line bg-surface px-5 py-4 text-left text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Deposit paid</dt>
            <dd className="font-medium tabular-nums">{formatPrice(paid)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Due at the studio</dt>
            <dd className="font-medium tabular-nums">{formatPrice(balance)}</dd>
          </div>
        </dl>
      )}

      <p className="mt-6 text-sm text-ink-muted">
        Need to change plans? Cancel free up to {config.cancellation_cutoff_hours} hours before
        {paid > 0 ? ' and your deposit is refunded in full.' : '.'}
      </p>

      <div className="mt-8 flex justify-center gap-3">
        <Link to="/appointments" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover">
          View my appointments
        </Link>
        {secondaryAction}
      </div>
    </div>
  )
}
