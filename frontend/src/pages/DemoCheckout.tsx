import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useDemoCheckout, useDemoCheckoutPay } from '../api/hooks'
import type { DemoCheckoutSession } from '../api/types'
import { Button, ErrorMessage, Loading } from '../components/ui'
import { formatPrice } from '../lib/dates'

/**
 * The demo payment provider's hosted checkout. Deliberately standalone (no app header), like
 * Stripe Checkout, which lives on its own page, so the flow reads the same either way.
 */
export function DemoCheckout() {
  const { sessionId } = useParams()
  const session = useDemoCheckout(sessionId)

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="bg-warn-soft px-4 py-2 text-center text-xs text-warn">
        <strong className="font-semibold">Demo checkout.</strong> This simulates a payment page. No card is needed and no
        money moves.
      </div>
      {session.isPending ? (
        <div className="grid place-items-center py-24">
          <Loading label="Loading checkout…" />
        </div>
      ) : session.error ? (
        <div className="mx-auto max-w-md px-4 py-24">
          <ErrorMessage error={session.error} />
          <Link to="/appointments" className="mt-4 inline-block text-sm text-brand hover:underline">
            Back to my appointments
          </Link>
        </div>
      ) : (
        <Checkout session={session.data} />
      )}
    </div>
  )
}

/** Turns an absolute return URL into an in-app path when it points at this site. */
function useReturnTo() {
  const navigate = useNavigate()
  return (url: string) => {
    const target = new URL(url, window.location.origin)
    if (target.origin === window.location.origin) navigate(target.pathname + target.search)
    else window.location.assign(url)
  }
}

function useCountdown(until: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const remaining = Math.max(0, new Date(until).getTime() - now)
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return { expired: remaining === 0, label: `${minutes}:${String(seconds).padStart(2, '0')}` }
}

function Checkout({ session }: { session: DemoCheckoutSession }) {
  const pay = useDemoCheckoutPay(session.id)
  const returnTo = useReturnTo()
  const countdown = useCountdown(session.expires_at)
  const [outcome, setOutcome] = useState<'success' | 'decline' | null>(null)
  const closed = session.status !== 'open' || countdown.expired

  function submit(choice: 'success' | 'decline') {
    setOutcome(choice)
    pay.mutate(choice, { onSuccess: ({ redirect_url }) => returnTo(redirect_url) })
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 md:grid-cols-2 md:gap-16 md:py-16">
      <section aria-label="Order summary">
        <button
          type="button"
          onClick={() => returnTo(session.cancel_url)}
          className="mb-8 inline-flex items-center gap-2 text-sm text-ink-soft hover:text-ink"
        >
          <span aria-hidden="true">←</span> Back to Studio Booking
        </button>
        <p className="text-sm text-ink-soft">{session.product_name}</p>
        <p className="mt-1 font-display text-5xl font-semibold tracking-tight tabular-nums">{formatPrice(session.amount)}</p>
        <p className="mt-4 max-w-sm text-sm text-ink-soft">{session.description}</p>
        <dl className="mt-8 max-w-sm space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Deposit</dt>
            <dd className="tabular-nums">{formatPrice(session.amount)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Total due today</dt>
            <dd className="tabular-nums">{formatPrice(session.amount)}</dd>
          </div>
        </dl>
      </section>

      <section aria-label="Payment" className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        {session.status === 'complete' ? (
          <div className="text-center">
            <p className="font-medium">This checkout is already paid.</p>
            <Link to="/appointments" className="mt-3 inline-block text-sm text-brand hover:underline">
              View my appointments
            </Link>
          </div>
        ) : closed ? (
          <div className="text-center">
            <p className="font-medium">This checkout has expired.</p>
            <p className="mt-1 text-sm text-ink-soft">The time was released. You can book again in a few clicks.</p>
            <Link to="/book" className="mt-4 inline-block text-sm text-brand hover:underline">
              Book again
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <h1 className="font-medium">Pay with card</h1>
              <p className="text-xs text-ink-muted" aria-live="off">
                Expires in <span className="tabular-nums">{countdown.label}</span>
              </p>
            </div>

            <div className="space-y-4">
              <MockField label="Email" value={session.customer_email} />
              <div>
                <span className="mb-1.5 block text-sm font-medium">Card information</span>
                <div className="overflow-hidden rounded-lg border border-line-strong">
                  <div className="flex items-center justify-between border-b border-line-strong px-3 py-2.5 text-sm tabular-nums">
                    <span>4242 4242 4242 4242</span>
                    <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-ink-soft">DEMO</span>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-line-strong text-sm tabular-nums">
                    <span className="px-3 py-2.5">12 / 34</span>
                    <span className="px-3 py-2.5">123</span>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-ink-muted">Pre-filled demo card. Nothing to type.</p>
              </div>
            </div>

            <div className="mt-6">
              <ErrorMessage error={pay.error} />
            </div>

            <Button className="mt-4 h-12 w-full text-base" loading={pay.isPending && outcome === 'success'} disabled={pay.isPending} onClick={() => submit('success')}>
              Pay {formatPrice(session.amount)}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              loading={pay.isPending && outcome === 'decline'}
              disabled={pay.isPending}
              onClick={() => submit('decline')}
            >
              Simulate a declined card
            </Button>
          </>
        )}
      </section>
    </div>
  )
}

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="rounded-lg border border-line-strong bg-canvas px-3 py-2.5 text-sm text-ink-soft">{value}</div>
    </div>
  )
}
