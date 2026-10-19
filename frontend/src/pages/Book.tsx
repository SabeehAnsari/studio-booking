import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAvailability, useConfig, useCreateAppointment, useServices, useStaff } from '../api/hooks'
import type { Appointment, AppConfig, Service, Slot, StaffMember } from '../api/types'
import { useAuth } from '../auth/context'
import { DemoLogin } from '../components/DemoLogin'
import { Button, Card, ErrorMessage, Loading, inputClass } from '../components/ui'
import {
  addDays,
  daysBetween,
  formatDateTime,
  formatDay,
  formatDuration,
  formatPrice,
  formatTime,
  hourIn,
  shortZone,
  todayIn,
} from '../lib/dates'

export function Book() {
  const { data: config } = useConfig()
  const services = useServices()
  if (!config || services.isPending) return <Loading />
  if (services.error) return <ErrorMessage error={services.error} />
  return <BookingFlow config={config} services={services.data ?? []} />
}

function BookingFlow({ config, services }: { config: AppConfig; services: Service[] }) {
  const [params, setParams] = useSearchParams()
  const [booked, setBooked] = useState<Appointment | null>(null)

  const serviceId = Number(params.get('service')) || undefined
  const staffParam = params.get('staff') // a staff id, or null for "any"
  const service = services.find((s) => s.id === serviceId)
  const staff = useStaff(serviceId)

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }

  if (booked)
    return (
      <Confirmation
        appointment={booked}
        config={config}
        onBookAnother={() => {
          setBooked(null)
          setParams({}, { replace: true })
        }}
      />
    )

  const selectedStaff = staffParam ? staff.data?.find((s) => String(s.id) === staffParam) : undefined
  const slotStart = params.get('slot')
  const slotStaffId = Number(params.get('with')) || undefined

  return (
    <div>
      <h1 className="mb-8 font-display text-3xl font-semibold tracking-tight">Book an appointment</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Step number={1} title="Choose a service" done={Boolean(service)}>
            <div className="grid gap-3 sm:grid-cols-2">
              {services.map((s) => (
                <OptionCard
                  key={s.id}
                  selected={s.id === serviceId}
                  onClick={() => update({ service: String(s.id), staff: null, slot: null, with: null, date: null })}
                  title={s.name}
                  meta={`${formatDuration(s.duration_minutes)} · ${formatPrice(s.price)}`}
                />
              ))}
            </div>
          </Step>

          {service && (
            <Step number={2} title="Who would you like to see?" done>
              {staff.isPending ? (
                <Loading />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <OptionCard
                    selected={!staffParam}
                    onClick={() => update({ staff: null, slot: null, with: null })}
                    title="Any available"
                    meta="Most open times"
                  />
                  {staff.data?.map((member) => (
                    <OptionCard
                      key={member.id}
                      selected={String(member.id) === staffParam}
                      onClick={() => update({ staff: String(member.id), slot: null, with: null })}
                      title={member.name}
                      meta={member.title}
                    />
                  ))}
                </div>
              )}
            </Step>
          )}

          {service && (
            <Step number={3} title="Pick a time" done={Boolean(slotStart)}>
              <SlotPicker
                config={config}
                service={service}
                staffId={selectedStaff?.id}
                date={params.get('date')}
                selected={slotStart}
                onDate={(date) => update({ date, slot: null, with: null })}
                onSelect={(slot) => update({ slot: slot.start, with: String(selectedStaff?.id ?? slot.staff_ids[0]) })}
              />
            </Step>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Summary
            config={config}
            service={service}
            staffMember={staff.data?.find((s) => s.id === slotStaffId) ?? selectedStaff}
            slotStart={slotStart}
            onBooked={setBooked}
            onConflict={() => update({ slot: null, with: null })}
          />
        </aside>
      </div>
    </div>
  )
}

function Step({ number, title, done, children }: { number: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${number}`}>
      <h2 id={`step-${number}`} className="mb-3 flex items-center gap-3 font-medium">
        <span
          className={`grid size-7 place-items-center rounded-full text-sm ${done ? 'bg-brand text-brand-ink' : 'border border-line-strong text-ink-soft'}`}
        >
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function OptionCard({ selected, onClick, title, meta }: { selected: boolean; onClick: () => void; title: string; meta?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border p-4 text-left transition-colors ${
        selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong'
      }`}
    >
      <span className={`block font-medium ${selected ? 'text-brand' : ''}`}>{title}</span>
      {meta && <span className="mt-0.5 block text-sm text-ink-muted">{meta}</span>}
    </button>
  )
}

const WEEK = 7

function SlotPicker({
  config,
  service,
  staffId,
  date,
  selected,
  onDate,
  onSelect,
}: {
  config: AppConfig
  service: Service
  staffId?: number
  date: string | null
  selected: string | null
  onDate: (date: string) => void
  onSelect: (slot: Slot) => void
}) {
  const tz = config.timezone
  const today = todayIn(tz)
  const lastDay = addDays(today, config.max_days_ahead)
  const [weekStart, setWeekStart] = useState(() => {
    if (!date) return today
    return addDays(today, Math.floor(daysBetween(today, date) / WEEK) * WEEK)
  })
  const weekEnd = addDays(weekStart, WEEK - 1)

  const availability = useAvailability({ service: service.id, staff: staffId, from: weekStart, to: weekEnd })
  const days = availability.data?.days ?? []
  const activeDate = date && date >= weekStart && date <= weekEnd ? date : days.find((d) => d.slots.length)?.date ?? weekStart
  const slots = days.find((d) => d.date === activeDate)?.slots ?? []

  useEffect(() => {
    // Keep the URL in sync with the auto-selected day so the link is shareable.
    if (availability.data && activeDate !== date) onDate(activeDate)
  }, [availability.data, activeDate, date, onDate])

  const groups = (() => {
    const buckets: { label: string; slots: Slot[] }[] = [
      { label: 'Morning', slots: [] },
      { label: 'Afternoon', slots: [] },
      { label: 'Evening', slots: [] },
    ]
    for (const slot of slots) {
      const hour = hourIn(slot.start, tz)
      buckets[hour < 12 ? 0 : hour < 17 ? 1 : 2].slots.push(slot)
    }
    return buckets.filter((b) => b.slots.length)
  })()

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" disabled={weekStart <= today} onClick={() => setWeekStart(addDays(weekStart, -WEEK))} aria-label="Previous week">
          ←
        </Button>
        <p className="text-sm font-medium">
          {formatDay(weekStart, { month: 'short', day: 'numeric' })} – {formatDay(weekEnd, { month: 'short', day: 'numeric' })}
        </p>
        <Button variant="ghost" size="sm" disabled={weekEnd >= lastDay} onClick={() => setWeekStart(addDays(weekStart, WEEK))} aria-label="Next week">
          →
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: WEEK }, (_, i) => {
          const day = addDays(weekStart, i)
          const count = days.find((d) => d.date === day)?.slots.length ?? 0
          const isActive = day === activeDate
          const loading = availability.isPending
          return (
            <button
              key={day}
              type="button"
              disabled={loading || count === 0}
              onClick={() => onDate(day)}
              aria-pressed={isActive}
              aria-label={`${formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} times available`}
              className={`flex flex-col items-center rounded-lg py-2 text-sm transition-colors disabled:cursor-not-allowed ${
                isActive ? 'bg-brand text-brand-ink' : count ? 'hover:bg-brand-soft' : 'text-ink-muted/60'
              }`}
            >
              <span className="text-xs">{formatDay(day, { weekday: 'short' })}</span>
              <span className="text-base font-medium">{formatDay(day, { day: 'numeric' })}</span>
              <span className={`mt-1 size-1.5 rounded-full ${count && !isActive ? 'bg-brand' : 'bg-transparent'}`} />
            </button>
          )
        })}
      </div>

      <div className="mt-5 border-t border-line pt-5">
        {availability.isPending ? (
          <Loading label="Finding open times…" />
        ) : availability.error ? (
          <ErrorMessage error={availability.error} />
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-soft">No open times this week. Try the next one →</p>
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-xs font-medium tracking-wide text-ink-muted uppercase">{group.label}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {group.slots.map((slot) => {
                    const isSelected = slot.start === selected
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => onSelect(slot)}
                        aria-pressed={isSelected}
                        className={`h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors ${
                          isSelected ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong hover:border-brand hover:text-brand'
                        }`}
                      >
                        {formatTime(slot.start, tz)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-5 text-xs text-ink-muted">Times shown in studio time ({shortZone(tz)}).</p>
      </div>
    </Card>
  )
}

function Summary({
  config,
  service,
  staffMember,
  slotStart,
  onBooked,
  onConflict,
}: {
  config: AppConfig
  service?: Service
  staffMember?: StaffMember
  slotStart: string | null
  onBooked: (appointment: Appointment) => void
  onConflict: () => void
}) {
  const { user } = useAuth()
  const location = useLocation()
  const create = useCreateAppointment()
  const [notes, setNotes] = useState('')
  const ready = Boolean(service && staffMember && slotStart)
  const next = location.pathname + location.search

  async function confirm() {
    if (!service || !staffMember || !slotStart) return
    try {
      onBooked(await create.mutateAsync({ service_id: service.id, staff_id: staffMember.id, start: slotStart, notes }))
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) onConflict()
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold">Your booking</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <SummaryRow label="Service" value={service?.name} />
        <SummaryRow label="With" value={staffMember?.name ?? (slotStart ? undefined : service ? 'Any available' : undefined)} />
        <SummaryRow label="When" value={slotStart ? formatDateTime(slotStart, config.timezone) : undefined} />
        {service && <SummaryRow label="Duration" value={formatDuration(service.duration_minutes)} />}
      </dl>
      {service && (
        <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
          <span className="text-sm text-ink-soft">Total</span>
          <span className="text-lg font-semibold">{formatPrice(service.price)}</span>
        </div>
      )}

      {ready && user?.role === 'customer' && (
        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Notes (optional)</span>
            <textarea
              className={`${inputClass} h-20 py-2`}
              placeholder="Anything we should know?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </label>
          <ErrorMessage error={create.error} />
          <Button className="w-full" loading={create.isPending} onClick={confirm}>
            Confirm booking
          </Button>
          <p className="text-xs text-ink-muted">Free cancellation up to {config.cancellation_cutoff_hours} hours before.</p>
        </div>
      )}

      {ready && user && user.role !== 'customer' && (
        <p className="mt-5 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          You're logged in as {user.role}. Switch to a customer account to book.
        </p>
      )}

      {ready && !user && (
        <div className="mt-5 space-y-3">
          <p className="text-sm text-ink-soft">Log in to confirm — your selection is saved.</p>
          {config.demo_mode && <DemoLogin next={next} compact />}
          <div className="flex gap-2">
            <Link to={`/login?next=${encodeURIComponent(next)}`} className="flex-1 rounded-lg border border-line-strong py-2 text-center text-sm font-medium hover:border-ink-muted">
              Log in
            </Link>
            <Link to={`/register?next=${encodeURIComponent(next)}`} className="flex-1 rounded-lg border border-line-strong py-2 text-center text-sm font-medium hover:border-ink-muted">
              Sign up
            </Link>
          </div>
        </div>
      )}
    </Card>
  )
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className={`text-right font-medium ${value ? '' : 'text-ink-muted'}`}>{value ?? '—'}</dd>
    </div>
  )
}

function Confirmation({
  appointment,
  config,
  onBookAnother,
}: {
  appointment: Appointment
  config: AppConfig
  onBookAnother: () => void
}) {
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
      <div className="mt-8 flex justify-center gap-3">
        <Link to="/appointments" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover">
          View my appointments
        </Link>
        <Button variant="secondary" onClick={onBookAnother}>
          Book another
        </Button>
      </div>
    </div>
  )
}
