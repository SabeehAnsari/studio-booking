import { useEffect, useState } from 'react'
import { useConfig } from '../api/hooks'
import { Spinner } from './ui'

const SLOW_AFTER_MS = 2500

/**
 * The API runs on a free host that sleeps when idle; the first request can take ~50 seconds.
 * If the very first call (config) is slow, say so instead of leaving visitors staring at spinners.
 */
export function WakingUpNotice() {
  const config = useConfig()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (!config.isPending) return
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [config.isPending])

  if (!config.isPending || !slow) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-brand-soft px-4 py-2 text-center text-sm text-brand">
      <Spinner className="size-4 shrink-0" />
      Waking up the demo server. It sleeps when nobody's using it, so this can take up to a minute the first time.
    </div>
  )
}
