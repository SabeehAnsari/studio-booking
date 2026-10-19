import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStaff } from '../api/hooks'
import type { Service } from '../api/types'
import { dayOf, formatDuration, formatPrice, formatRelativeSlot } from '../lib/dates'

/** Groups services by category, keeping the order the API returns (category order, then name). */
function groupByCategory(services: Service[]) {
  const groups: { key: string; label: string; services: Service[] }[] = []
  for (const service of services) {
    let group = groups.find((g) => g.key === service.category)
    if (!group) groups.push((group = { key: service.category, label: service.category_label, services: [] }))
    group.services.push(service)
  }
  return groups
}

function slotLink(service: Service, timeZone: string) {
  const next = service.next_available
  if (!next) return `/book?service=${service.id}`
  const params = new URLSearchParams({
    service: String(service.id),
    date: dayOf(next.start, timeZone),
    slot: next.start,
    with: String(next.staff_id),
  })
  return `/book?${params}`
}

export function ServiceMenu({ services, timeZone }: { services: Service[]; timeZone: string }) {
  const [category, setCategory] = useState<string | null>(null)
  const staff = useStaff()
  const groups = groupByCategory(services)
  const visible = category ? groups.filter((g) => g.key === category) : groups

  const staffNames = (serviceId: number) =>
    staff.data?.filter((s) => s.service_ids.includes(serviceId)).map((s) => s.name.split(' ')[0]) ?? []

  return (
    <div>
      <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Filter by category">
        {[{ key: null, label: 'All' }, ...groups].map((g) => {
          const active = category === g.key
          return (
            <button
              key={g.key ?? 'all'}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(g.key)}
              className={`h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors ${
                active ? 'border-brand bg-brand text-brand-ink' : 'border-line-strong text-ink-soft hover:border-ink-muted hover:text-ink'
              }`}
            >
              {g.label}
            </button>
          )
        })}
      </div>

      <div className="space-y-10">
        {visible.map((group) => (
          <section key={group.key} aria-labelledby={`cat-${group.key}`}>
            <h3 id={`cat-${group.key}`} className="mb-3 flex items-baseline gap-2 font-display text-xl font-semibold">
              {group.label}
              <span className="font-sans text-sm font-normal text-ink-muted">{group.services.length}</span>
            </h3>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {group.services.map((service) => {
                const names = staffNames(service.id)
                return (
                  <li
                    key={service.id}
                    className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex items-baseline justify-between gap-4 sm:justify-start">
                        <Link to={`/book?service=${service.id}`} className="font-medium hover:text-brand">
                          {service.name}
                        </Link>
                        <span className="shrink-0 font-medium tabular-nums sm:hidden">{formatPrice(service.price)}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-ink-soft">{service.description}</p>
                      <p className="mt-1.5 text-xs text-ink-muted">
                        {formatDuration(service.duration_minutes)}
                        {names.length > 0 && <> · with {names.join(', ')}</>}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 sm:justify-end">
                      <span className="hidden w-16 text-right font-medium tabular-nums sm:block">{formatPrice(service.price)}</span>
                      {service.next_available ? (
                        <Link
                          to={slotLink(service, timeZone)}
                          className="group inline-flex h-9 items-center gap-2 rounded-lg bg-brand-soft px-3 text-sm text-brand transition-colors hover:bg-brand hover:text-brand-ink"
                          aria-label={`Book ${service.name}, next opening ${formatRelativeSlot(service.next_available.start, timeZone)}`}
                        >
                          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                          <span>
                            <span className="opacity-75">Next </span>
                            <span className="font-medium">{formatRelativeSlot(service.next_available.start, timeZone)}</span>
                          </span>
                        </Link>
                      ) : (
                        <span className="text-sm text-ink-muted">Fully booked</span>
                      )}
                      <Link
                        to={`/book?service=${service.id}`}
                        className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 text-sm font-medium hover:border-ink-muted"
                      >
                        All times
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
