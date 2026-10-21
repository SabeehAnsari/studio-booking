import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useConfig, useCreateAppointment, useServices, useStaff } from '../api/hooks'
import type { Appointment, AppConfig, Service, StaffMember } from '../api/types'
import { useAuth } from '../auth/context'
import { BookingConfirmation } from '../components/BookingConfirmation'
import { DemoLogin } from '../components/DemoLogin'
import { SlotPicker } from '../components/SlotPicker'
import { Button, Card, ErrorMessage, Loading, inputClass } from '../components/ui'
import { formatDateTime, formatDuration, formatPrice } from '../lib/dates'

export function Book() {
  const { data: config, error: configError } = useConfig()
  const services = useServices()
  if (services.error || configError) return <ErrorMessage error={services.error ?? configError} />
  if (!config || services.isPending) return <Loading />
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
      <BookingConfirmation
        appointment={booked}
        config={config}
        secondaryAction={
          <Button
            variant="secondary"
            onClick={() => {
              setBooked(null)
              setParams({}, { replace: true })
            }}
          >
            Book another
          </Button>
        }
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
  const [redirecting, setRedirecting] = useState(false)
  const ready = Boolean(service && staffMember && slotStart)
  const next = location.pathname + location.search
  const deposit = config.payments_enabled && service ? Number(service.deposit) : 0

  async function confirm() {
    if (!service || !staffMember || !slotStart) return
    try {
      const result = await create.mutateAsync({ service_id: service.id, staff_id: staffMember.id, start: slotStart, notes })
      if (result.checkout_url) {
        // The slot is now held for us; Stripe takes it from here and sends the customer back.
        setRedirecting(true)
        window.location.assign(result.checkout_url)
      } else onBooked(result)
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
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-soft">Total</span>
            <span className={deposit ? 'font-medium' : 'text-lg font-semibold'}>{formatPrice(service.price)}</span>
          </div>
          {deposit > 0 && (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-soft">Deposit due now</span>
                <span className="text-lg font-semibold">{formatPrice(deposit)}</span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-ink-soft">Pay at the studio</span>
                <span className="tabular-nums">{formatPrice(Number(service.price) - deposit)}</span>
              </div>
            </>
          )}
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
          <Button className="w-full" loading={create.isPending || redirecting} onClick={confirm}>
            {deposit > 0 ? `Continue to payment · ${formatPrice(deposit)}` : 'Confirm booking'}
          </Button>
          <p className="text-xs text-ink-muted">
            {deposit > 0
              ? `${config.payment_provider === 'stripe' ? 'Secure payment by Stripe. ' : ''}Cancel up to ${config.cancellation_cutoff_hours} hours before for a full refund.`
              : `Free cancellation up to ${config.cancellation_cutoff_hours} hours before.`}
          </p>
          {deposit > 0 && config.payment_provider === 'demo' && (
            <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs text-ink-soft">
              <strong className="font-medium text-ink">Demo checkout:</strong> you'll see a simulated payment page. No card
              needed and nothing is charged.
            </p>
          )}
          {deposit > 0 && config.payment_provider === 'stripe' && config.payments_test_mode && (
            <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs text-ink-soft">
              <strong className="font-medium text-ink">Test mode:</strong> pay with card{' '}
              <span className="font-medium whitespace-nowrap text-ink tabular-nums">4242 4242 4242 4242</span>, any future
              date and any CVC. No real money moves.
            </p>
          )}
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
