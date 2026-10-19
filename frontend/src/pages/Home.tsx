import { Link } from 'react-router-dom'
import { useConfig, useServices } from '../api/hooks'
import type { Service } from '../api/types'
import { useAuth } from '../auth/context'
import { DemoLogin } from '../components/DemoLogin'
import { ServiceMenu } from '../components/ServiceMenu'
import { Card, ErrorMessage, Loading } from '../components/ui'
import { formatRelativeSlot } from '../lib/dates'

function earliestOpening(services: Service[]) {
  return services
    .map((s) => s.next_available?.start)
    .filter((start): start is string => Boolean(start))
    .sort()[0]
}

export function Home() {
  const { user } = useAuth()
  const { data: config, error: configError } = useConfig()
  const services = useServices()
  const nextOpening = services.data && earliestOpening(services.data)

  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 md:grid-cols-[1.2fr_1fr]">
        <div>
          <p className="mb-3 text-sm font-medium tracking-wide text-brand uppercase">Massage · Skin · Hair</p>
          <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Book your next visit in under a minute.
          </h1>
          <p className="mt-4 max-w-lg text-lg text-ink-soft">
            Pick a treatment, choose who you'd like to see, and grab a time that's actually free — no phone tag.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              to="/book"
              className="inline-flex h-11 items-center rounded-lg bg-brand px-5 font-medium text-brand-ink hover:bg-brand-hover"
            >
              Book an appointment
            </Link>
            {nextOpening && config && (
              <p className="flex items-center gap-2 text-sm text-ink-soft">
                <span className="relative flex size-2" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex size-2 rounded-full bg-good" />
                </span>
                Next opening <strong className="font-medium text-ink">{formatRelativeSlot(nextOpening, config.timezone)}</strong>
              </p>
            )}
          </div>
        </div>

        {config?.demo_mode && !user && (
          <Card className="p-6">
            <h2 className="font-display text-xl font-semibold">Explore the demo</h2>
            <p className="mt-1 mb-5 text-sm text-ink-soft">
              Jump in as any role — no sign-up. Each sees a different side of the system.
            </p>
            <DemoLogin />
          </Card>
        )}
      </section>

      <section id="services" aria-labelledby="services-heading">
        <div className="mb-6">
          <h2 id="services-heading" className="font-display text-3xl font-semibold tracking-tight">
            Services &amp; prices
          </h2>
          <p className="mt-1 text-ink-soft">Tap a time to book it straight away, or see every opening.</p>
        </div>
        {services.error || configError ? (
          <ErrorMessage error={services.error ?? configError} />
        ) : services.isPending || !config ? (
          <Loading />
        ) : (
          <ServiceMenu services={services.data} timeZone={config.timezone} />
        )}
      </section>
    </div>
  )
}
