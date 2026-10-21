import { useAppointments, useConfig } from '../api/hooks'
import type { AppConfig } from '../api/types'
import { useAuth } from '../auth/context'
import { AppointmentList } from '../components/AppointmentList'
import { Button, EmptyState, ErrorMessage, Loading, PageHeader } from '../components/ui'
import { useSearchParams } from 'react-router-dom'
import { addDays, dayOf, formatDay, formatPrice, todayIn } from '../lib/dates'

export function StaffSchedule() {
  const { data: config } = useConfig()
  if (!config) return <Loading />
  return <Schedule config={config} />
}

function Schedule({ config }: { config: AppConfig }) {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const today = todayIn(config.timezone)
  const day = params.get('date') ?? today
  const appointments = useAppointments({ date: day })
  // On an empty day, look ahead so the page can offer a jump to the next day with bookings.
  const emptyDay = appointments.data?.results.length === 0
  const upcoming = useAppointments({ scope: 'upcoming' }, { enabled: emptyDay })
  const nextBookedDay = upcoming.data?.results.map((a) => dayOf(a.start, config.timezone)).find((d) => d > day)
  const setDay = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true })

  const list = appointments.data?.results ?? []
  const active = list.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
  const revenue = active.reduce((sum, a) => sum + Number(a.price), 0)

  return (
    <div>
      <PageHeader
        title={day === today ? 'Today' : formatDay(day, { weekday: 'long' })}
        subtitle={
          <>
            {formatDay(day, { weekday: 'long', month: 'long', day: 'numeric' })} · {user?.full_name}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
              ←
            </Button>
            <Button variant="secondary" size="sm" disabled={day === today} onClick={() => setDay(today)}>
              Today
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDay(addDays(day, 1))} aria-label="Next day">
              →
            </Button>
          </div>
        }
      />

      {appointments.data && active.length > 0 && (
        <p className="mb-4 text-sm text-ink-soft">
          <strong className="text-ink">{active.length}</strong> appointment{active.length === 1 ? '' : 's'}
          {revenue > 0 && (
            <>
              {' · '}
              <strong className="text-ink">{formatPrice(revenue)}</strong> booked
            </>
          )}
        </p>
      )}

      {appointments.isPending ? (
        <Loading />
      ) : appointments.error ? (
        <ErrorMessage error={appointments.error} />
      ) : list.length === 0 ? (
        <EmptyState title="No appointments">
          {nextBookedDay ? (
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setDay(nextBookedDay)}>
              Next booked day: {formatDay(nextBookedDay, { weekday: 'long', month: 'short', day: 'numeric' })} →
            </Button>
          ) : (
            'Enjoy the quiet, or check another day.'
          )}
        </EmptyState>
      ) : (
        <AppointmentList appointments={list} role="staff" config={config} timeOnly />
      )}
    </div>
  )
}
