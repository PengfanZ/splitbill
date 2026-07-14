import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS,
  LIVE_ACTIVITY_POLL_INTERVAL_MS,
  useLiveActivityPolling,
} from './useLiveActivityPolling'

type PollHarnessProps = {
  enabled?: boolean
  onResult: (result: string) => void
  poll: () => Promise<string>
}

function PollHarness({ enabled = true, onResult, poll }: PollHarnessProps) {
  useLiveActivityPolling({ enabled, onResult, poll })
  return null
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value })
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}

describe('live activity polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
    setOnline(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    setVisibility('visible')
    setOnline(true)
  })

  it('polls at the base interval only while enabled', async () => {
    const poll = vi.fn().mockResolvedValue('latest')
    const onResult = vi.fn()
    const view = render(<PollHarness enabled={false} poll={poll} onResult={onResult} />)

    await advance(LIVE_ACTIVITY_POLL_INTERVAL_MS * 2)
    expect(poll).not.toHaveBeenCalled()

    view.rerender(<PollHarness poll={poll} onResult={onResult} />)
    await advance(LIVE_ACTIVITY_POLL_INTERVAL_MS)
    expect(poll).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenLastCalledWith('latest')

    await advance(LIVE_ACTIVITY_POLL_INTERVAL_MS)
    expect(poll).toHaveBeenCalledTimes(2)
    expect(onResult).toHaveBeenCalledTimes(2)
  })

  it('pauses while hidden or offline and refreshes when available again', async () => {
    const poll = vi.fn().mockResolvedValue('latest')
    const onResult = vi.fn()
    setVisibility('hidden')
    render(<PollHarness poll={poll} onResult={onResult} />)

    await advance(LIVE_ACTIVITY_POLL_INTERVAL_MS)
    expect(poll).not.toHaveBeenCalled()

    setVisibility('visible')
    fireEvent(document, new Event('visibilitychange'))
    await act(async () => { await Promise.resolve() })
    expect(poll).toHaveBeenCalledOnce()

    setVisibility('hidden')
    await advance(LIVE_ACTIVITY_POLL_INTERVAL_MS)
    expect(poll).toHaveBeenCalledOnce()
    fireEvent(document, new Event('visibilitychange'))

    setVisibility('visible')
    setOnline(false)
    fireEvent(window, new Event('focus'))
    fireEvent(document, new Event('visibilitychange'))
    expect(poll).toHaveBeenCalledOnce()

    setOnline(true)
    fireEvent(window, new Event('online'))
    await act(async () => { await Promise.resolve() })
    expect(poll).toHaveBeenCalledTimes(2)
    expect(onResult).toHaveBeenCalledTimes(2)
  })

  it('backs off after failures, caps the delay, and resets after success', async () => {
    const poll = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('recovered')
    const onResult = vi.fn()
    render(<PollHarness poll={poll} onResult={onResult} />)

    await advance(LIVE_ACTIVITY_POLL_INTERVAL_MS)
    expect(poll).toHaveBeenCalledTimes(1)
    await advance((LIVE_ACTIVITY_POLL_INTERVAL_MS * 2) - 1)
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(poll).toHaveBeenCalledTimes(2)

    await advance(LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS)
    expect(poll).toHaveBeenCalledTimes(3)
    await advance(LIVE_ACTIVITY_MAX_POLL_INTERVAL_MS)
    expect(poll).toHaveBeenCalledTimes(4)
    expect(onResult).toHaveBeenCalledWith('recovered')

    await advance(LIVE_ACTIVITY_POLL_INTERVAL_MS)
    expect(poll).toHaveBeenCalledTimes(5)
  })

  it('deduplicates an in-flight refresh and ignores it after cleanup', async () => {
    let resolvePoll!: (value: string) => void
    const poll = vi.fn(() => new Promise<string>(resolve => { resolvePoll = resolve }))
    const onResult = vi.fn()
    const view = render(<PollHarness poll={poll} onResult={onResult} />)

    fireEvent(window, new Event('focus'))
    expect(poll).toHaveBeenCalledOnce()
    fireEvent(window, new Event('focus'))
    expect(poll).toHaveBeenCalledOnce()

    view.unmount()
    await act(async () => { resolvePoll('late') })
    expect(onResult).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
