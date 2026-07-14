import { useEffect, useEffectEvent } from 'react'

export const LIVE_ACTIVITY_POLL_INTERVAL_MS = 15_000
export const LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS = 60_000

type UseLiveActivityPollingOptions<Result> = {
  enabled: boolean
  onResult: (result: Result) => void
  poll: () => Promise<Result>
}

function pollingIsAvailable() {
  return document.visibilityState === 'visible' && navigator.onLine !== false
}

export function useLiveActivityPolling<Result>({
  enabled,
  onResult,
  poll,
}: UseLiveActivityPollingOptions<Result>) {
  const onResultEvent = useEffectEvent(onResult)
  const pollEvent = useEffectEvent(poll)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let inFlight = false
    let nextDelay = LIVE_ACTIVITY_POLL_INTERVAL_MS
    let timerId = 0

    const schedule = () => {
      if (!cancelled && pollingIsAvailable()) {
        timerId = window.setTimeout(run, nextDelay)
      }
    }

    const run = async () => {
      if (inFlight || !pollingIsAvailable()) return
      inFlight = true
      try {
        const result = await pollEvent()
        if (cancelled) return
        nextDelay = LIVE_ACTIVITY_POLL_INTERVAL_MS
        onResultEvent(result)
      } catch {
        nextDelay = Math.min(nextDelay * 2, LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS)
      } finally {
        inFlight = false
        schedule()
      }
    }

    const refreshWhenAvailable = () => {
      window.clearTimeout(timerId)
      if (pollingIsAvailable()) void run()
    }

    schedule()
    window.addEventListener('focus', refreshWhenAvailable)
    window.addEventListener('online', refreshWhenAvailable)
    document.addEventListener('visibilitychange', refreshWhenAvailable)
    return () => {
      cancelled = true
      window.clearTimeout(timerId)
      window.removeEventListener('focus', refreshWhenAvailable)
      window.removeEventListener('online', refreshWhenAvailable)
      document.removeEventListener('visibilitychange', refreshWhenAvailable)
    }
  }, [enabled])
}
