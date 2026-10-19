import { useState } from 'react'
import { useAppointmentAction, usePayAppointment, type AppointmentAction } from '../api/hooks'
import type { AppConfig, Appointment, Role } from '../api/types'
import { formatDateTime, formatDuration, formatPrice, formatTime } from '../lib/dates'
import { useToast } from '../lib/toast'
import { ConfirmDialog } from './ConfirmDialog'
import { Button, ErrorMessage, StatusBadge } from './ui'

type RowAction = AppointmentAction | 'pay'

const actionLabels: Record<RowAction, string> = {
  pay: 'Pay deposit',
  confirm: 'Confirm',
  complete: 'Mark done',
  'no-show': 'No-show',
  cancel: 'Cancel',
}

const successMessages: Record<AppointmentAction, (a: Appointment, refunded?: string | null) => string> = {
  cancel: (a, refunded) =>
    a.status === 'awaiting_payment'
      ? 'Time released. Nothing was charged.'
      : `${a.service.name} cancelled${refunded ? ` · ${formatPrice(refunded)} deposit refunded` : ''}`,
  confirm: (a) => `Confirmed ${a.customer.first_name || 'the customer'}'s ${a.service.name}`,
  complete: () => 'Marked as completed',
  'no-show': () => 'Marked as no-show',
}

function actionsFor(appointment: Appointment, role: Role, config: AppConfig): RowAction[] {
  if (appointment.status === 'awaiting_payment') return role === 'customer' ? ['pay', 'cancel'] : ['cancel']
  const active = appointment.status === 'pending' || appointment.status === 'confirmed'
  if (!active) return []
  const started = new Date(appointment.start) <= new Date()
  if (role === 'customer') {
    const cutoff = new Date(appointment.start).getTime() - config.cancellation_cutoff_hours * 3_600_000
    return Date.now() < cutoff ? ['cancel'] : []
  }
  const actions: RowAction[] = []
  if (appointment.status === 'pending') actions.push('confirm')
  if (started) actions.push('complete', 'no-show')
  else actions.push('cancel')
  return actions
}

export function AppointmentList({
  appointments,
  role,
  config,
  timeOnly = false,
}: {
  appointments: Appointment[]
  role: Role
  config: AppConfig
  timeOnly?: boolean
}) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {appointments.map((a) => (
        <AppointmentRow key={a.id} appointment={a} role={role} config={config} timeOnly={timeOnly} />
      ))}
    </ul>
  )
}

function PaymentNote({ appointment: a, timeZone }: { appointment: Appointment; timeZone: string }) {
  if (a.status === 'awaiting_payment' && a.hold_expires_at) {
    return <p className="text-xs text-warn">Held until {formatTime(a.hold_expires_at, timeZone)}</p>
  }
  if (a.payment?.status === 'paid') {
    return <p className="text-xs text-ink-muted">{formatPrice(a.payment.amount)} deposit paid</p>
  }
  if (a.payment?.status === 'refunded') {
    return <p className="text-xs text-ink-muted">{formatPrice(a.payment.amount)} deposit refunded</p>
  }
  return null
}

function AppointmentRow({
  appointment: a,
  role,
  config,
  timeOnly,
}: {
  appointment: Appointment
  role: Role
  config: AppConfig
  timeOnly: boolean
}) {
  const mutation = useAppointmentAction()
  const pay = usePayAppointment()
  const toast = useToast()
  const [pendingAction, setPendingAction] = useState<AppointmentAction | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const actions = actionsFor(a, role, config)
  const tz = config.timezone
  const unpaidHold = a.status === 'awaiting_payment'
  const paidDeposit = a.payment?.status === 'paid' ? a.payment.amount : null

  function perform(action: AppointmentAction) {
    setPendingAction(action)
    mutation.mutate(
      { id: a.id, action },
      {
        onSuccess: (result) => {
          setConfirmingCancel(false)
          toast(successMessages[action](a, result.refunded_amount), unpaidHold ? 'info' : 'success')
        },
        onSettled: () => setPendingAction(null),
      },
    )
  }

  function run(action: RowAction) {
    if (action === 'pay') pay.mutate(a.id)
    else if (action === 'cancel') {
      mutation.reset()
      setConfirmingCancel(true)
    } else perform(action)
  }

  const who = role === 'customer' ? `with ${a.staff.name}` : a.customer.full_name || a.customer.email
  const inactive = a.status === 'cancelled' || a.status === 'no_show' || a.status === 'expired'
  const rowError = pay.error ?? (confirmingCancel ? null : mutation.error)

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
      <div className={`shrink-0 ${timeOnly ? 'w-48' : 'w-52'}`}>
        <p className={`font-medium tabular-nums ${inactive ? 'text-ink-muted line-through' : ''}`}>
          {timeOnly ? `${formatTime(a.start, tz)} – ${formatTime(a.end, tz)}` : formatDateTime(a.start, tz)}
        </p>
        <p className="text-xs text-ink-muted">{formatDuration(a.service.duration_minutes)}</p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{a.service.name}</p>
        <p className="truncate text-sm text-ink-soft">
          {who}
          {role === 'admin' && <span className="text-ink-muted"> · with {a.staff.name}</span>}
        </p>
        {a.notes && role !== 'customer' && <p className="mt-1 text-sm text-ink-muted italic">“{a.notes}”</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm tabular-nums text-ink-soft">{formatPrice(a.price)}</p>
          <PaymentNote appointment={a} timeZone={tz} />
        </div>
        <StatusBadge status={a.status} />
      </div>
      {actions.length > 0 && (
        <div className="flex w-full gap-2 sm:w-auto">
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={
                action === 'cancel' ? 'danger' : action === 'pay' || action === 'complete' || action === 'confirm' ? 'primary' : 'secondary'
              }
              loading={action === 'pay' ? pay.isPending : pendingAction === action}
              disabled={mutation.isPending || pay.isPending}
              onClick={() => run(action)}
            >
              {action === 'cancel' && unpaidHold && role === 'customer' ? 'Release' : actionLabels[action]}
            </Button>
          ))}
        </div>
      )}
      {rowError && (
        <div className="w-full">
          <ErrorMessage error={rowError} />
        </div>
      )}

      <ConfirmDialog
        open={confirmingCancel}
        title={unpaidHold ? 'Release this time?' : 'Cancel this appointment?'}
        confirmLabel={unpaidHold ? 'Release time' : 'Cancel appointment'}
        cancelLabel="Keep it"
        destructive
        pending={pendingAction === 'cancel'}
        error={mutation.error}
        onConfirm={() => perform('cancel')}
        onClose={() => setConfirmingCancel(false)}
      >
        <div className="rounded-xl border border-line bg-canvas px-4 py-3">
          <p className="font-medium text-ink">{a.service.name}</p>
          <p className="mt-0.5">{formatDateTime(a.start, tz)}</p>
          <p className="mt-0.5">
            {role === 'customer' ? `with ${a.staff.name}` : `${who} · with ${a.staff.name}`} · {formatPrice(a.price)}
          </p>
        </div>
        <p className="mt-3">
          {unpaidHold
            ? 'No payment has been taken. The time goes back on the calendar for anyone to book.'
            : paidDeposit
              ? role === 'customer'
                ? `Your ${formatPrice(paidDeposit)} deposit will be refunded to your card. Refunds usually arrive within 5–10 business days.`
                : `The customer's ${formatPrice(paidDeposit)} deposit will be refunded automatically. This can’t be undone.`
              : role === 'customer'
                ? 'The time will be released for someone else to book. You can always book again later.'
                : 'The customer will need to rebook. This can’t be undone.'}
        </p>
      </ConfirmDialog>
    </li>
  )
}
