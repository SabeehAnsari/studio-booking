import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAppointment, useConfig, useRescheduleAppointment, useStaff } from '../api/hooks'
import type { AppConfig, Appointment, Role, Slot } from '../api/types'
import { useAuth } from '../auth/context'
import { SlotPicker } from '../components/SlotPicker'
import { Button, Card, ErrorMessage, Loading, PageHeader } from '../components/ui'
import { dayOf, formatDateTime, formatPrice } from '../lib/dates'
import { useToast } from '../lib/toast'

export function Reschedule() {
  const { id } = useParams()
  const { data: config, error: configError } = useConfig()
  const appointment = useAppointment(Number(id) || undefined)
  const { user } = useAuth()

  if (configError || appointment.error) return <ErrorMessage error={configError ?? appointment.error} />
  if (!config || appointment.isPending || !user) return <Loading />
  return <RescheduleFlow appointment={appointment.data} config={config} role={user.role} />
}

/** Where to go once the booking has moved: back to wherever this role manages bookings. */
function backTo(role: Role, newStart?: string, timeZone?: string) {
  if (role === 'staff') return newStart && timeZone ? `/schedule?date=${dayOf(newStart, timeZone)}` : '/schedule'
  return role === 'admin' ? '/admin' : '/appointments'
}

function RescheduleFlow({ appointment: a, config, role }: { appointment: Appointment; config: AppConfig; role: Role }) {
  const tz = config.timezone
  const navigate = useNavigate()
  const toast = useToast()
  const staff = useStaff(a.service.id)
  const reschedule = useRescheduleAppointment()
  const [staffChoice, setStaffChoice] = useState<number | 'any'>(a.staff.id)
  const [date, setDate] = useState<string | null>(dayOf(a.start, tz))
  const [slot, setSlot] = useState<Slot | null>(null)
  // Captured once: whether the booking is still movable is decided when the page opens.
  const [openedAt] = useState(() => Date.now())

  const cutoff = new Date(a.start).getTime() - config.cancellation_cutoff_hours * 3_600_000
  const movable =
    (a.status === 'confirmed' || a.status === 'pending') &&
    openedAt < (role === 'customer' ? cutoff : new Date(a.start).getTime())
  if (!movable) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">This booking can't be moved</h1>
        <p className="mt-3 text-ink-soft">
          {a.status === 'confirmed' || a.status === 'pending'
            ? `Bookings can be moved up to ${config.cancellation_cutoff_hours} hours before they start. Please contact the studio directly.`
            : 'Only upcoming, confirmed bookings can be rescheduled.'}
        </p>
        <Link to={backTo(role)} className="mt-8 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover">
          Back
        </Link>
      </div>
    )
  }

  const pickedStaffId = staffChoice === 'any' ? slot?.staff_ids[0] : staffChoice
  const pickedStaff = staff.data?.find((s) => s.id === pickedStaffId)
  const isCurrentStaff = staffChoice === a.staff.id

  function confirm() {
    if (!slot || !pickedStaffId) return
    reschedule.mutate(
      { id: a.id, start: slot.start, staffId: pickedStaffId === a.staff.id ? undefined : pickedStaffId },
      {
        onSuccess: (moved) => {
          toast(`Moved to ${formatDateTime(moved.start, tz)}`)
          navigate(backTo(role, moved.start, tz))
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) setSlot(null)
        },
      },
    )
  }

  return (
    <div>
      <PageHeader
        title="Reschedule"
        subtitle={
          <>
            {a.service.name}
            {role !== 'customer' && <> for {a.customer.full_name || a.customer.email}</>} · currently{' '}
            <strong className="font-medium text-ink">{formatDateTime(a.start, tz)}</strong> with {a.staff.name}
          </>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section aria-labelledby="who">
            <h2 id="who" className="mb-3 font-medium">
              With
            </h2>
            {staff.isPending ? (
              <Loading />
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Staff member">
                {[...(staff.data ?? [])]
                  .sort((x, y) => Number(y.id === a.staff.id) - Number(x.id === a.staff.id))
                  .map((member) => (
                    <StaffChip
                      key={member.id}
                      selected={staffChoice === member.id}
                      label={member.id === a.staff.id ? `${member.name} (current)` : member.name}
                      onClick={() => {
                        setStaffChoice(member.id)
                        setSlot(null)
                      }}
                    />
                  ))}
                <StaffChip
                  selected={staffChoice === 'any'}
                  label="Any available"
                  onClick={() => {
                    setStaffChoice('any')
                    setSlot(null)
                  }}
                />
              </div>
            )}
          </section>

          <section aria-labelledby="when">
            <h2 id="when" className="mb-3 font-medium">
              New time
            </h2>
            <SlotPicker
              config={config}
              service={a.service}
              staffId={staffChoice === 'any' ? undefined : staffChoice}
              date={date}
              selected={slot?.start ?? null}
              onDate={(d) => {
                setDate(d)
                setSlot(null)
              }}
              onSelect={setSlot}
              excludeAppointmentId={a.id}
              currentStart={isCurrentStaff ? a.start : undefined}
            />
          </section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">Your change</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">From</dt>
                <dd className="text-right text-ink-muted line-through">
                  {formatDateTime(a.start, tz)}
                  <br />
                  {a.staff.name}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-soft">To</dt>
                <dd className={`text-right font-medium ${slot ? '' : 'text-ink-muted'}`}>
                  {slot ? (
                    <>
                      {formatDateTime(slot.start, tz)}
                      <br />
                      {pickedStaff?.name ?? a.staff.name}
                    </>
                  ) : (
                    'Pick a time'
                  )}
                </dd>
              </div>
            </dl>
            {a.payment?.status === 'paid' && (
              <p className="mt-4 border-t border-line pt-4 text-xs text-ink-muted">
                Your {formatPrice(a.payment.amount)} deposit stays with the booking.
              </p>
            )}
            <div className="mt-5 space-y-3">
              <ErrorMessage error={reschedule.error} />
              <Button className="w-full" disabled={!slot} loading={reschedule.isPending} onClick={confirm}>
                Move booking
              </Button>
              <Link to={backTo(role)} className="block text-center text-sm text-ink-soft hover:text-ink">
                Keep the current time
              </Link>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function StaffChip({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-9 rounded-full border px-4 text-sm font-medium transition-colors ${
        selected ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong text-ink-soft hover:border-ink-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}
