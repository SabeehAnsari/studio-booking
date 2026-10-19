/**
 * Date helpers. Calendar days are plain "YYYY-MM-DD" strings in the business timezone;
 * instants are ISO strings from the API, always formatted in the business timezone so
 * a visitor in another zone sees the studio's local times.
 */

export function todayIn(timeZone: string): string {
  return dayOf(new Date(), timeZone)
}

export function dayOf(instant: Date | string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(typeof instant === 'string' ? new Date(instant) : instant)
  const get = (type: string) => parts.find((p) => p.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

/** Format a calendar day (no timezone shift: it's already a local day). */
export function formatDay(day: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}

export function formatTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant))
}

export function formatDateTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant))
}

/** "Today 2:15 PM", "Tomorrow 9:00 AM", or "Thu, Oct 22 9:00 AM" — in the business timezone. */
export function formatRelativeSlot(instant: string, timeZone: string) {
  const day = dayOf(instant, timeZone)
  const today = todayIn(timeZone)
  const label =
    day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' })
  return `${label} ${formatTime(instant, timeZone)}`
}

export function hourIn(instant: string, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(instant)))
}

export function shortZone(timeZone: string) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? timeZone
}

export function formatPrice(value: string | number) {
  const amount = Number(value)
  if (amount === 0) return 'Free'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount)
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
