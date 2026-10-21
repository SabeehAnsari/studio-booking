import { useEffect, useState } from 'react'
import { useAvailability } from '../api/hooks'
import type { AppConfig, Service, Slot } from '../api/types'
import { addDays, daysBetween, formatDay, formatTime, hourIn, shortZone, todayIn } from '../lib/dates'
import { Button, Card, ErrorMessage, Loading } from './ui'

const WEEK = 7

export function SlotPicker({
  config,
  service,
  staffId,
  date,
  selected,
  onDate,
  onSelect,
  excludeAppointmentId,
  currentStart,
}: {
  config: AppConfig
  service: Service
  staffId?: number
  date: string | null
  selected: string | null
  onDate: (date: string) => void
  onSelect: (slot: Slot) => void
  /** Rescheduling: treat this booking's own time as free… */
  excludeAppointmentId?: number
  /** …and label its current slot. */
  currentStart?: string
}) {
  const tz = config.timezone
  const today = todayIn(tz)
  const lastDay = addDays(today, config.max_days_ahead)
  const [weekStart, setWeekStart] = useState(() => {
    if (!date) return today
    return addDays(today, Math.floor(daysBetween(today, date) / WEEK) * WEEK)
  })
  const weekEnd = addDays(weekStart, WEEK - 1)

  const availability = useAvailability({
    service: service.id,
    staff: staffId,
    from: weekStart,
    to: weekEnd,
    exclude: excludeAppointmentId,
  })
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
                    const isCurrent = slot.start === currentStart
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => onSelect(slot)}
                        aria-pressed={isSelected}
                        aria-label={isCurrent ? `${formatTime(slot.start, tz)}, your current time` : undefined}
                        className={`relative h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors ${
                          isSelected
                            ? 'border-brand bg-brand text-brand-ink'
                            : isCurrent
                              ? 'border-dashed border-ink-muted text-ink-muted'
                              : 'border-line-strong hover:border-brand hover:text-brand'
                        }`}
                      >
                        {formatTime(slot.start, tz)}
                        {isCurrent && (
                          <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-surface px-1 text-[10px] leading-tight font-medium text-ink-muted">
                            current
                          </span>
                        )}
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
