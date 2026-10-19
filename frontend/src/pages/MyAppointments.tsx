import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppointments, useConfig } from '../api/hooks'
import { useAuth } from '../auth/context'
import { AppointmentList } from '../components/AppointmentList'
import { EmptyState, ErrorMessage, Loading, PageHeader } from '../components/ui'

export function MyAppointments() {
  const { user } = useAuth()
  const { data: config } = useConfig()
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const appointments = useAppointments({ scope: tab })

  return (
    <div>
      <PageHeader
        title={`Hi, ${user?.first_name}`}
        subtitle="Your upcoming visits and booking history."
        actions={
          <Link to="/book" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover">
            New booking
          </Link>
        }
      />
      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface p-1" role="tablist">
        {(['upcoming', 'past'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize ${tab === t ? 'bg-brand-soft text-brand' : 'text-ink-soft hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {appointments.isPending || !config ? (
        <Loading />
      ) : appointments.error ? (
        <ErrorMessage error={appointments.error} />
      ) : appointments.data.results.length === 0 ? (
        <EmptyState title={tab === 'upcoming' ? 'Nothing booked yet' : 'No past appointments'}>
          {tab === 'upcoming' && (
            <Link to="/book" className="font-medium text-brand hover:underline">
              Find a time →
            </Link>
          )}
        </EmptyState>
      ) : (
        <AppointmentList appointments={appointments.data.results} role="customer" config={config} />
      )}
    </div>
  )
}
