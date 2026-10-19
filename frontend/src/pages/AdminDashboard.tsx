import { useState } from 'react'
import { useAppointments, useConfig, useDashboard, useStaff } from '../api/hooks'
import type { AppConfig, Dashboard } from '../api/types'
import { AppointmentList } from '../components/AppointmentList'
import { Button, Card, EmptyState, ErrorMessage, Loading, PageHeader, selectClass } from '../components/ui'
import { formatDay, formatPrice } from '../lib/dates'

export function AdminDashboard() {
  const { data: config } = useConfig()
  const dashboard = useDashboard()

  return (
    <div className="space-y-10">
      <PageHeader title="Dashboard" subtitle="How the studio is doing, at a glance." />
      {dashboard.isPending || !config ? (
        <Loading />
      ) : dashboard.error ? (
        <ErrorMessage error={dashboard.error} />
      ) : (
        <>
          <KpiRow data={dashboard.data} />
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <BookingsChart days={dashboard.data.upcoming_by_day} />
            <div className="space-y-6">
              <RankedList title="Top services · 30 days" rows={dashboard.data.top_services} unit="bookings" />
              <RankedList title="Staff load · next 14 days" rows={dashboard.data.staff_load} unit="appointments" />
            </div>
          </div>
          <AllAppointments config={config} />
        </>
      )}
    </div>
  )
}

function KpiRow({ data }: { data: Dashboard }) {
  const tiles = [
    { label: 'Appointments today', value: String(data.today_count) },
    { label: 'Next 14 days', value: String(data.upcoming_14d_count) },
    {
      label: 'Revenue this month',
      value: formatPrice(data.revenue_month_to_date),
      note: `+ ${formatPrice(data.booked_revenue_rest_of_month)} booked`,
    },
    { label: 'Cancellation & no-show rate', value: `${Math.round(data.cancellation_rate_30d * 100)}%`, note: 'Last 30 days' },
  ]
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label} className="p-5">
          <p className="text-sm text-ink-soft">{tile.label}</p>
          <p className="mt-2 font-display text-3xl font-semibold tabular-nums">{tile.value}</p>
          {tile.note && <p className="mt-1 text-xs text-ink-muted">{tile.note}</p>}
        </Card>
      ))}
    </div>
  )
}

const CHART_HEIGHT = 180

function BookingsChart({ days }: { days: Dashboard['upcoming_by_day'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const max = Math.max(4, ...days.map((d) => d.count))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="font-medium">Bookings · next 14 days</h2>
        <button className="text-sm text-ink-soft underline-offset-2 hover:text-ink hover:underline" onClick={() => setShowTable((s) => !s)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="py-1.5 font-medium">Day</th>
              <th className="py-1.5 text-right font-medium">Bookings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {days.map((d) => (
              <tr key={d.date}>
                <td className="py-1.5">{formatDay(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                <td className="py-1.5 text-right tabular-nums">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex gap-3">
          {/* Y axis */}
          <div className="relative mt-10 w-6 shrink-0 text-right text-xs text-ink-muted tabular-nums" style={{ height: CHART_HEIGHT }}>
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: CHART_HEIGHT - (t / top) * CHART_HEIGHT }}>
                {t}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative mt-10" style={{ height: CHART_HEIGHT }} onMouseLeave={() => setHover(null)}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className={`absolute inset-x-0 border-t ${t === 0 ? 'border-line-strong' : 'border-line'}`}
                  style={{ top: CHART_HEIGHT - (t / top) * CHART_HEIGHT }}
                />
              ))}
              <div className="absolute inset-0 flex">
                {days.map((d, i) => (
                  <div
                    key={d.date}
                    className="relative flex flex-1 items-end justify-center"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${formatDay(d.date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${d.count} bookings`}
                  >
                    {hover === i && <div className="absolute inset-y-0 inset-x-0.5 rounded bg-line/50" />}
                    <div
                      className="relative w-[55%] max-w-6 rounded-t bg-brand transition-opacity"
                      style={{ height: Math.max((d.count / top) * CHART_HEIGHT, d.count ? 2 : 0), opacity: hover === null || hover === i ? 1 : 0.55 }}
                    />
                    {hover === i && (
                      <div className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-sm">
                        <p className="text-ink-muted">{formatDay(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                        <p className="font-medium text-ink tabular-nums">{d.count} bookings</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* X axis */}
            <div className="mt-2 flex text-xs text-ink-muted">
              {days.map((d, i) => (
                <span key={d.date} className="flex-1 text-center">
                  {i % 2 === 0 ? formatDay(d.date, { day: 'numeric' }) : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function niceTicks(max: number): number[] {
  const step = Math.max(1, Math.ceil(max / 4))
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

function RankedList({ title, rows, unit }: { title: string; rows: { name: string; count: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No data yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.name} className="text-sm">
              <div className="mb-1 flex justify-between gap-3">
                <span>{row.name}</span>
                <span className="text-ink-soft tabular-nums" aria-label={`${row.count} ${unit}`}>
                  {row.count}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-line">
                <div className="h-full rounded-full bg-brand" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function AllAppointments({ config }: { config: AppConfig }) {
  const staff = useStaff()
  const [filters, setFilters] = useState<{ scope: 'upcoming' | 'past'; staff?: number; status: string; page: number }>({
    scope: 'upcoming',
    status: '',
    page: 1,
  })
  const appointments = useAppointments(filters)
  const set = (changes: Partial<typeof filters>) => setFilters({ ...filters, page: 1, ...changes })
  const totalPages = appointments.data ? Math.max(1, Math.ceil(appointments.data.count / 50)) : 1

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold tracking-tight">All appointments</h2>
        <div className="flex flex-wrap gap-2">
          <select className={selectClass} value={filters.scope} onChange={(e) => set({ scope: e.target.value as 'upcoming' | 'past' })} aria-label="Time range">
            <option value="upcoming">Upcoming</option>
            <option value="past">Past &amp; cancelled</option>
          </select>
          <select
            className={selectClass}
            value={filters.staff ?? ''}
            onChange={(e) => set({ staff: e.target.value ? Number(e.target.value) : undefined })}
            aria-label="Staff member"
          >
            <option value="">All staff</option>
            {staff.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select className={selectClass} value={filters.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
            <option value="">Any status</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No-show</option>
          </select>
        </div>
      </div>

      {appointments.isPending ? (
        <Loading />
      ) : appointments.error ? (
        <ErrorMessage error={appointments.error} />
      ) : appointments.data.results.length === 0 ? (
        <EmptyState title="No appointments match these filters" />
      ) : (
        <>
          <AppointmentList appointments={appointments.data.results} role="admin" config={config} />
          <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
            <span>
              {appointments.data.count} total · page {filters.page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={!appointments.data.previous} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={!appointments.data.next} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
