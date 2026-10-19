import { useState } from 'react'
import { useAppointmentAction, type AppointmentAction } from '../api/hooks'
import type { AppConfig, Appointment, Role } from '../api/types'
import { formatDateTime, formatDuration, formatPrice, formatTime } from '../lib/dates'
import { useToast } from '../lib/toast'
import { ConfirmDialog } from './ConfirmDialog'
import { Button, ErrorMessage, StatusBadge } from './ui'

const actionLabels: Record<AppointmentAction, string> = {
  confirm: 'Confirm',
  complete: 'Mark done',
  'no-show': 'No-show',
  cancel: 'Cancel',
}

const successMessages: Record<AppointmentAction, (a: Appointment) => string> = {
  cancel: (a) => `${a.service.name} cancelled`,
  confirm: (a) => `Confirmed ${a.customer.first_name || 'the customer'}'s ${a.service.name}`,
  complete: () => 'Marked as completed',
  'no-show': () => 'Marked as no-show',
}

function actionsFor(appointment: Appointment, role: Role, config: AppConfig): AppointmentAction[] {
  const active = appointment.status === 'pending' || appointment.status === 'confirmed'
  if (!active) return []
  const started = new Date(appointment.start) <= new Date()
  if (role === 'customer') {
    const cutoff = new Date(appointment.start).getTime() - config.cancellation_cutoff_hours * 3_600_000
    return Date.now() < cutoff ? ['cancel'] : []
  }
  const actions: AppointmentAction[] = []
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
  const toast = useToast()
  const [pendingAction, setPendingAction] = useState<AppointmentAction | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const actions = actionsFor(a, role, config)
  const tz = config.timezone

  function perform(action: AppointmentAction) {
    setPendingAction(action)
    mutation.mutate(
      { id: a.id, action },
      {
        onSuccess: () => {
          setConfirmingCancel(false)
          toast(successMessages[action](a))
        },
        onSettled: () => setPendingAction(null),
      },
    )
  }

  function run(action: AppointmentAction) {
    if (action === 'cancel') {
      mutation.reset()
      setConfirmingCancel(true)
    } else perform(action)
  }

  const who = role === 'customer' ? `with ${a.staff.name}` : a.customer.full_name || a.customer.email
  const inactive = a.status === 'cancelled' || a.status === 'no_show'

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
        <span className="text-sm tabular-nums text-ink-soft">{formatPrice(a.price)}</span>
        <StatusBadge status={a.status} />
      </div>
      {actions.length > 0 && (
        <div className="flex w-full gap-2 sm:w-auto">
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === 'cancel' ? 'danger' : action === 'complete' || action === 'confirm' ? 'primary' : 'secondary'}
              loading={pendingAction === action}
              disabled={mutation.isPending}
              onClick={() => run(action)}
            >
              {actionLabels[action]}
            </Button>
          ))}
        </div>
      )}
      {mutation.error && !confirmingCancel && (
        <div className="w-full">
          <ErrorMessage error={mutation.error} />
        </div>
      )}

      <ConfirmDialog
        open={confirmingCancel}
        title="Cancel this appointment?"
        confirmLabel="Cancel appointment"
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
          {role === 'customer'
            ? "The time will be released for someone else to book. You can always book again later."
            : 'The customer will need to rebook. This can’t be undone.'}
        </p>
      </ConfirmDialog>
    </li>
  )
}
