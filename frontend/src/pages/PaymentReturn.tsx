import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAppointment, useAppointmentAction, useCheckoutStatus, useConfig, usePayAppointment } from '../api/hooks'
import { BookingConfirmation } from '../components/BookingConfirmation'
import { Button, Card, ErrorMessage, Loading } from '../components/ui'
import { formatDateTime, formatPrice, formatTime } from '../lib/dates'
import { useToast } from '../lib/toast'

/** Stripe's success_url. Confirms the payment with the API, which double-checks it with Stripe. */
export function BookingConfirmed() {
  const [params] = useSearchParams()
  const { data: config } = useConfig()
  const status = useCheckoutStatus(params.get('session_id'))

  if (!params.get('session_id')) return <ErrorMessage error={new Error('Missing payment reference.')} />
  if (status.error) return <ErrorMessage error={status.error} />
  if (!config || !status.data || status.data.payment_status === 'pending') {
    return (
      <div className="mx-auto max-w-md text-center">
        <Loading label="Confirming your payment with Stripe…" />
      </div>
    )
  }

  const { appointment, payment_status } = status.data
  if (payment_status === 'refunded') {
    // Rare: the hold lapsed and the slot was taken before the payment landed. The API refunded it.
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">That time was just taken</h1>
        <p className="mt-3 text-ink-soft">
          Your payment came through after the hold on {formatDateTime(appointment.start, config.timezone)} ran out, and
          someone else booked it. We've refunded your deposit in full. Sorry about that.
        </p>
        <Link to={`/book?service=${appointment.service.id}`} className="mt-8 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover">
          Pick another time
        </Link>
      </div>
    )
  }

  return (
    <BookingConfirmation
      appointment={appointment}
      config={config}
      secondaryAction={
        <Link to="/book" className="inline-flex h-10 items-center rounded-lg border border-line-strong px-4 text-sm font-medium hover:border-ink-muted">
          Book another
        </Link>
      }
    />
  )
}

/** Stripe's cancel_url: the customer backed out of checkout. Their slot is still held for a while. */
export function PaymentCancelled() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const id = Number(params.get('appointment')) || undefined
  const { data: config } = useConfig()
  const appointment = useAppointment(id)
  const pay = usePayAppointment()
  const release = useAppointmentAction()

  if (appointment.isPending || !config) return <Loading />
  if (appointment.error) return <ErrorMessage error={appointment.error} />
  const a = appointment.data
  const tz = config.timezone

  if (a.status !== 'awaiting_payment') {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {a.status === 'confirmed' ? 'This booking is already paid' : 'This hold has ended'}
        </h1>
        <p className="mt-3 text-ink-soft">
          {a.status === 'confirmed'
            ? `${a.service.name} on ${formatDateTime(a.start, tz)} is confirmed.`
            : 'The time was released because the deposit wasn’t paid. You can book again in a few clicks.'}
        </p>
        <Link to={a.status === 'confirmed' ? '/appointments' : `/book?service=${a.service.id}`} className="mt-8 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover">
          {a.status === 'confirmed' ? 'View my appointments' : 'Book again'}
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Payment not completed</h1>
      <p className="mt-2 text-ink-soft">No money was taken. We're still holding your time, but not for long.</p>

      <Card className="mt-6 p-5">
        <p className="font-medium">{a.service.name}</p>
        <p className="mt-0.5 text-sm text-ink-soft">
          {formatDateTime(a.start, tz)} · with {a.staff.name}
        </p>
        {a.hold_expires_at && (
          <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            Held until {formatTime(a.hold_expires_at, tz)}. After that, the time is released to other customers.
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button className="sm:flex-1" loading={pay.isPending} onClick={() => pay.mutate(a.id)}>
            Pay {a.payment ? formatPrice(a.payment.amount) : 'deposit'} now
          </Button>
          <Button
            variant="secondary"
            className="sm:flex-1"
            loading={release.isPending}
            onClick={() =>
              release.mutate(
                { id: a.id, action: 'cancel' },
                {
                  onSuccess: () => {
                    toast('Time released. Nothing was charged.', 'info')
                    navigate(`/book?service=${a.service.id}`)
                  },
                },
              )
            }
          >
            Release this time
          </Button>
        </div>
        <div className="mt-3">
          <ErrorMessage error={pay.error ?? release.error} />
        </div>
      </Card>
    </div>
  )
}
