import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LiveActivityStatusBanner } from './LiveActivityStatusBanner'

describe('LiveActivityStatusBanner', () => {
  it('shows one synchronized Live session with an optional manual refresh', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    render(
      <LiveActivityStatusBanner
        state="connected"
        code="A1B2C3D4E5"
        browserOnline
        onRefresh={onRefresh}
      />,
    )

    expect(screen.getByText('Live and synced · A1B2C3D4E5')).toBeVisible()
    expect(screen.getByText(/same activity/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Duplicate and edit' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh latest' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('makes a cached activity read-only and offers an explicit independent branch', async () => {
    const user = userEvent.setup()
    const onDuplicate = vi.fn()
    render(
      <LiveActivityStatusBanner
        state="cached"
        code="A1B2C3D4E5"
        browserOnline={false}
        notice="Could not reach the live activity service."
        hasBookmark
        onDuplicate={onDuplicate}
      />,
    )

    expect(screen.getByText('You’re offline')).toBeVisible()
    expect(screen.getByText(/last synced copy/)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('Could not reach')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Duplicate and edit' }))
    expect(onDuplicate).toHaveBeenCalledOnce()
  })

  it('offers reconnection while an online cached activity is paused', async () => {
    const onRefresh = vi.fn()
    render(
      <LiveActivityStatusBanner
        state="cached"
        browserOnline
        refreshing
        onRefresh={onRefresh}
      />,
    )

    expect(screen.getByText('Live connection paused')).toBeVisible()
    expect(screen.getByRole('button', { name: /Loading/ })).toBeDisabled()
  })

  it('explains opening, recovery after expiration, and unavailable links', async () => {
    const user = userEvent.setup()
    const onContinueLocally = vi.fn()
    const onBack = vi.fn()
    const { rerender } = render(
      <LiveActivityStatusBanner
        state="opening"
        browserOnline
      />,
    )
    expect(screen.getByText('Opening live activity')).toBeVisible()
    expect(screen.getByText('Loading the latest version…')).toBeVisible()

    rerender(
      <LiveActivityStatusBanner
        state="expired"
        code="A1B2C3D4E5"
        browserOnline
        onContinueLocally={onContinueLocally}
      />,
    )

    expect(screen.getByText('Live sharing has ended')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Continue locally' }))
    expect(onContinueLocally).toHaveBeenCalledOnce()

    rerender(
      <LiveActivityStatusBanner
        state="unavailable"
        browserOnline
        notice="This link is invalid."
        onBack={onBack}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('This link is invalid.')
    await user.click(screen.getByRole('button', { name: 'Back to my activities' }))
    expect(onBack).toHaveBeenCalledOnce()

    rerender(
      <LiveActivityStatusBanner
        state="unavailable"
        browserOnline={false}
      />,
    )
    expect(screen.getByText('Tally could not open this Live activity and no saved copy is available on this device.')).toBeVisible()

    rerender(
      <LiveActivityStatusBanner
        state="connected"
        browserOnline
      />,
    )
    expect(screen.getByText('Live and synced ·')).toBeVisible()
  })
})
