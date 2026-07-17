import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyticsClient, AnalyticsSurface } from '../analytics'
import { useAppAnalytics } from './useAppAnalytics'

function Harness({ client, surface, code }: {
  client: AnalyticsClient | null
  surface: AnalyticsSurface
  code: string | null
}) {
  useAppAnalytics(client, surface, code)
  return null
}

describe('app analytics lifecycle', () => {
  it('tracks one app open and each newly opened live activity', () => {
    const client = { track: vi.fn() }
    const view = render(<Harness client={client} surface="local" code={null} />)

    expect(client.track).toHaveBeenCalledWith('app_opened', 'local')
    view.rerender(<Harness client={client} surface="snapshot" code="A1B2C3D4E5" />)
    expect(client.track).toHaveBeenCalledWith('live_activity_opened', 'live')

    view.rerender(<Harness client={client} surface="live" code="A1B2C3D4E5" />)
    view.rerender(<Harness client={client} surface="live" code={null} />)
    view.rerender(<Harness client={client} surface="live" code="A1B2C3D4E5" />)
    expect(client.track).toHaveBeenCalledTimes(3)
  })

  it('is safe when analytics is disabled', () => {
    expect(() => render(<Harness client={null} surface="local" code="A1B2C3D4E5" />)).not.toThrow()
  })
})
