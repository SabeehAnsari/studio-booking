import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import {
  useAddTimeOff,
  useConfig,
  useDeleteTimeOff,
  useMyStaffProfile,
  useSaveStaffHours,
  useStaff,
  useStaffHours,
  useTimeOff,
} from '../api/hooks'
import type { AppConfig, AppointmentBrief, TimeOff, WorkingHours } from '../api/types'
import { useAuth } from '../auth/context'
import { Button, Card, EmptyState, ErrorMessage, Loading, PageHeader, compactInputClass, inputClass, selectClass } from '../components/ui'
import { addDays, dayOf, formatDateTime, formatDay, formatTime, todayIn } from '../lib/dates'
import { useToast } from '../lib/toast'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

type Shift = { start: string; end: string }
type Week = Shift[][] // index = weekday (0 = Monday)

export function StaffAvailability() {
  const { user } = useAuth()
  const { data: config, error: configError } = useConfig()
  const isAdmin = user?.role === 'admin'
  const me = useMyStaffProfile(user?.role === 'staff')
  const allStaff = useStaff()
  const [params, setParams] = useSearchParams()

  const staffId = isAdmin ? Number(params.get('staff')) || allStaff.data?.[0]?.id : me.data?.id
  const staffName = isAdmin ? allStaff.data?.find((s) => s.id === staffId)?.name : me.data?.name

  if (configError || me.error) return <ErrorMessage error={configError ?? me.error} />
  if (!config || !staffId) return <Loading />

  return (
    <div className="space-y-8">
      <PageHeader
        title={isAdmin ? 'Staff availability' : 'My availability'}
        subtitle={
          isAdmin
            ? 'Set when each person works and when they’re away. Customers can only book inside these hours.'
            : 'When you work and when you’re away. Customers can only book you inside these hours.'
        }
        actions={
          isAdmin && (
            <select
              className={selectClass}
              value={staffId}
              onChange={(e) => setParams({ staff: e.target.value }, { replace: true })}
              aria-label="Staff member"
            >
              {allStaff.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )
        }
      />
      {/* key: reset the editors' local state when an admin switches staff member */}
      <WeeklyHours key={`hours-${staffId}`} staffId={staffId} staffName={isAdmin ? staffName : undefined} config={config} />
      <TimeOffSection key={`off-${staffId}`} staffId={staffId} config={config} />
    </div>
  )
}

// ── Weekly hours ────────────────────────────────────────────────────────────

function toWeek(hours: WorkingHours[]): Week {
  const week: Week = WEEKDAYS.map(() => [])
  for (const h of [...hours].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    week[h.weekday].push({ start: h.start_time.slice(0, 5), end: h.end_time.slice(0, 5) })
  }
  return week
}

function fromWeek(week: Week): WorkingHours[] {
  return week.flatMap((shifts, weekday) => shifts.map((s) => ({ weekday, start_time: s.start, end_time: s.end })))
}

/** Problems with one day's shifts, in plain words; empty when the day is fine. */
function dayProblem(shifts: Shift[]): string | null {
  if (shifts.some((s) => !s.start || !s.end)) return 'Fill in both times.'
  if (shifts.some((s) => s.end <= s.start)) return 'A shift has to end after it starts.'
  const sorted = [...shifts].sort((a, b) => a.start.localeCompare(b.start))
  if (sorted.some((s, i) => i > 0 && s.start < sorted[i - 1].end)) return 'Two shifts overlap.'
  return null
}

function addHour(time: string, hours: number) {
  const [h, m] = time.split(':').map(Number)
  return `${String(Math.min(h + hours, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function WeeklyHours({ staffId, staffName, config }: { staffId: number; staffName?: string; config: AppConfig }) {
  const hours = useStaffHours(staffId)
  if (hours.error) return <ErrorMessage error={hours.error} />
  if (hours.isPending) return <Loading />
  return <WeeklyHoursEditor staffId={staffId} staffName={staffName} saved={toWeek(hours.data.hours)} config={config} />
}

function WeeklyHoursEditor({
  staffId,
  staffName,
  saved,
  config,
}: {
  staffId: number
  staffName?: string
  saved: Week
  config: AppConfig
}) {
  const save = useSaveStaffHours(staffId)
  const toast = useToast()
  const [week, setWeek] = useState<Week>(saved)
  const [outside, setOutside] = useState<AppointmentBrief[]>([])
  const dirty = JSON.stringify(week) !== JSON.stringify(saved)
  const problems = week.map(dayProblem)
  const valid = problems.every((p) => p === null)

  const update = (day: number, shifts: Shift[]) => setWeek(week.map((s, i) => (i === day ? shifts : s)))

  function submit() {
    save.mutate(fromWeek(week), {
      onSuccess: (result) => {
        setOutside(result.outside_hours)
        toast(staffName ? `Saved ${staffName}'s hours` : 'Hours saved')
      },
    })
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-xl font-semibold">Weekly hours</h2>
        <p className="mt-1 text-sm text-ink-soft">The same every week. Add more than one shift a day for breaks.</p>
      </div>

      <ul className="divide-y divide-line">
        {week.map((shifts, day) => (
          <li key={day} className="grid gap-3 py-4 sm:grid-cols-[8rem_1fr] sm:items-start">
            <p className={`pt-2 font-medium ${shifts.length ? '' : 'text-ink-muted'}`}>{WEEKDAYS[day]}</p>
            <div className="space-y-2">
              {shifts.length === 0 && <p className="pt-2 text-sm text-ink-muted">Not working</p>}
              {shifts.map((shift, i) => (
                <div key={i} className="flex max-w-md items-center gap-1.5 sm:gap-2">
                  <input
                    type="time"
                    step={900}
                    className={`${compactInputClass} min-w-0 flex-1 px-2 sm:w-32 sm:flex-none sm:px-3`}
                    value={shift.start}
                    aria-label={`${WEEKDAYS[day]} shift ${i + 1} start`}
                    onChange={(e) => update(day, shifts.map((s, j) => (j === i ? { ...s, start: e.target.value } : s)))}
                  />
                  <span className="text-ink-muted" aria-hidden="true">
                    –
                  </span>
                  <input
                    type="time"
                    step={900}
                    className={`${compactInputClass} min-w-0 flex-1 px-2 sm:w-32 sm:flex-none sm:px-3`}
                    value={shift.end}
                    aria-label={`${WEEKDAYS[day]} shift ${i + 1} end`}
                    onChange={(e) => update(day, shifts.map((s, j) => (j === i ? { ...s, end: e.target.value } : s)))}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${WEEKDAYS[day]} shift ${i + 1}`}
                    onClick={() => update(day, shifts.filter((_, j) => j !== i))}
                  >
                    ✕
                  </Button>
                </div>
              ))}
              {problems[day] && (
                <p className="text-sm text-bad" role="alert">
                  {problems[day]}
                </p>
              )}
              <button
                type="button"
                className="text-sm font-medium text-brand hover:underline"
                onClick={() => {
                  const last = shifts[shifts.length - 1]
                  const start = last ? addHour(last.end, 1) : '09:00'
                  update(day, [...shifts, { start, end: last ? addHour(start, 3) : '17:00' }])
                }}
              >
                + {shifts.length ? 'Add another shift' : 'Add hours'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {outside.length > 0 && (
        <AffectedBookings
          tone="warn"
          title={`${outside.length} upcoming booking${outside.length === 1 ? ' is' : 's are'} now outside these hours`}
          description="They're still booked. Move or cancel them if they no longer work."
          bookings={outside}
          config={config}
        />
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
        <ErrorMessage error={save.error} />
        {dirty && <span className="text-sm text-ink-muted">Unsaved changes</span>}
        <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => setWeek(saved)}>
          Discard
        </Button>
        <Button disabled={!dirty || !valid} loading={save.isPending} onClick={submit}>
          Save hours
        </Button>
      </div>
    </Card>
  )
}

// ── Time off ────────────────────────────────────────────────────────────────

function isMidnight(instant: string, tz: string) {
  return formatTime(instant, tz) === '12:00 AM'
}

/** "Mon, Nov 2 – Wed, Nov 4 (all day)" or "Mon, Nov 2, 9:00 AM – 12:00 PM". */
function describeTimeOff(off: TimeOff, tz: string) {
  const day = (iso: string) => formatDay(dayOf(iso, tz), { weekday: 'short', month: 'short', day: 'numeric' })
  if (isMidnight(off.start, tz) && isMidnight(off.end, tz)) {
    const first = dayOf(off.start, tz)
    const last = addDays(dayOf(off.end, tz), -1)
    return first === last ? `${day(off.start)} (all day)` : `${day(off.start)} – ${formatDay(last, { weekday: 'short', month: 'short', day: 'numeric' })} (all day)`
  }
  const sameDay = dayOf(off.start, tz) === dayOf(off.end, tz)
  return sameDay
    ? `${day(off.start)}, ${formatTime(off.start, tz)} – ${formatTime(off.end, tz)}`
    : `${formatDateTime(off.start, tz)} – ${formatDateTime(off.end, tz)}`
}

function TimeOffSection({ staffId, config }: { staffId: number; config: AppConfig }) {
  const tz = config.timezone
  const today = todayIn(tz)
  const list = useTimeOff(staffId)
  const add = useAddTimeOff(staffId)
  const remove = useDeleteTimeOff(staffId)
  const toast = useToast()
  const [form, setForm] = useState({ from: today, to: today, allDay: true, startTime: '09:00', endTime: '17:00', reason: '' })

  const conflicts =
    add.error instanceof ApiError && add.error.status === 409
      ? ((add.error.data as { conflicts?: AppointmentBrief[] }).conflicts ?? [])
      : []

  function submit(e: FormEvent) {
    e.preventDefault()
    const start = `${form.from}T${form.allDay ? '00:00' : form.startTime}`
    const end = form.allDay ? `${addDays(form.to, 1)}T00:00` : `${form.to}T${form.endTime}`
    add.mutate(
      { start, end, reason: form.reason },
      {
        onSuccess: () => {
          toast('Time off added')
          setForm({ ...form, reason: '' })
        },
      },
    )
  }

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm({ ...form, [key]: value })

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="font-display text-xl font-semibold">Time off</h2>
        <p className="mt-1 text-sm text-ink-soft">Holidays, appointments, training: nobody can book you during these times.</p>
      </div>

      <form onSubmit={submit} className="grid gap-4 rounded-xl border border-line bg-canvas p-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">From</span>
          <div className="flex gap-2">
            <input type="date" className={inputClass} required min={today} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value, to: e.target.value > form.to ? e.target.value : form.to })} />
            {!form.allDay && <input type="time" step={900} className={`${compactInputClass} w-32 shrink-0`} aria-label="From time" required value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />}
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">To</span>
          <div className="flex gap-2">
            <input type="date" className={inputClass} required min={form.from} value={form.to} onChange={(e) => set('to', e.target.value)} />
            {!form.allDay && <input type="time" step={900} className={`${compactInputClass} w-32 shrink-0`} aria-label="To time" required value={form.endTime} onChange={(e) => set('endTime', e.target.value)} />}
          </div>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-(--color-brand)" checked={form.allDay} onChange={(e) => set('allDay', e.target.checked)} />
          All day
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium">Reason (optional)</span>
          <input className={inputClass} maxLength={200} placeholder="e.g. Holiday" value={form.reason} onChange={(e) => set('reason', e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" loading={add.isPending}>
            Add time off
          </Button>
          <span className="text-xs text-ink-muted">Times are in studio time.</span>
        </div>
        {add.error && conflicts.length === 0 && (
          <div className="sm:col-span-2">
            <ErrorMessage error={add.error} />
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="sm:col-span-2">
            <AffectedBookings
              tone="bad"
              title={add.error instanceof Error ? add.error.message : 'Bookings fall in that time'}
              description="Nothing was saved. Move or cancel these bookings, then add the time off again."
              bookings={conflicts}
              config={config}
            />
          </div>
        )}
      </form>

      <div className="mt-5">
        {list.isPending ? (
          <Loading />
        ) : list.error ? (
          <ErrorMessage error={list.error} />
        ) : list.data.length === 0 ? (
          <EmptyState title="No time off coming up" />
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {list.data.map((off) => (
              <li key={off.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium">{describeTimeOff(off, tz)}</p>
                  {off.reason && <p className="text-sm text-ink-soft">{off.reason}</p>}
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  loading={remove.isPending && remove.variables === off.id}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(off.id, { onSuccess: () => toast('Time off removed', 'info') })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function AffectedBookings({
  tone,
  title,
  description,
  bookings,
  config,
}: {
  tone: 'warn' | 'bad'
  title: string
  description: string
  bookings: AppointmentBrief[]
  config: AppConfig
}) {
  const colours = tone === 'warn' ? 'border-warn/30 bg-warn-soft text-warn' : 'border-bad/30 bg-bad-soft text-bad'
  return (
    <div role="alert" className={`mt-5 rounded-xl border px-4 py-3 ${colours}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-0.5 text-sm opacity-90">{description}</p>
      <ul className="mt-3 space-y-1.5 text-sm text-ink">
        {bookings.map((b) => (
          <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span>
              <span className="tabular-nums">{formatDateTime(b.start, config.timezone)}</span> · {b.service} · {b.customer}
            </span>
            <Link to={`/appointments/${b.id}/reschedule`} className="font-medium text-brand hover:underline">
              Reschedule
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
