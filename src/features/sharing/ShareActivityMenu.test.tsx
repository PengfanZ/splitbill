import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ShareActivityMenu } from './ShareActivityMenu'

describe('ShareActivityMenu', () => {
  it('presents Live collaboration and a complete export for local activities', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCollaborateLive = vi.fn()
    const onShareSummary = vi.fn()
    render(<ShareActivityMenu
      groupName="Weekend trip"
      onClose={onClose}
      onCollaborateLive={onCollaborateLive}
      onShareSummary={onShareSummary}
    />)

    expect(screen.getByRole('dialog', { name: 'Share activity' })).toBeVisible()
    expect(screen.getByText('Invite people to edit Weekend trip together, or export a complete summary.')).toBeVisible()
    expect(screen.getByText('CAN EDIT · STAYS IN SYNC')).toBeVisible()
    expect(screen.getByText('everyone sees the latest version.', { exact: false })).toBeVisible()
    expect(screen.getByText('Includes every expense, payment, total, and who owes whom.')).toBeVisible()
    expect(screen.queryByText(/snapshot/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start live activity' }))
    await user.click(screen.getByRole('button', { name: /^Export full summary/ }))

    expect(onCollaborateLive).toHaveBeenCalledOnce()
    expect(onShareSummary).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('uses the live-link action, omits unavailable actions, and supports every close path', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCopyLink = vi.fn().mockResolvedValue(undefined)
    const onEndLive = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<ShareActivityMenu groupName="Cabin" live onClose={onClose} onCopyLink={onCopyLink} onEndLive={onEndLive} />)

    expect(screen.getByText('Invite people to edit live')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy live invite link' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'End live' })).toBeVisible()
    expect(screen.queryByText(/snapshot/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start live activity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show live QR' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy live invite link' }))
    await user.click(screen.getByRole('button', { name: 'End live' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.mouseDown(container.querySelector('.modal')!)
    fireEvent.mouseDown(container.querySelector('.modal-backdrop')!)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCopyLink).toHaveBeenCalledOnce()
    expect(onEndLive).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledTimes(5)
  })

  it('renders available Live actions independently and hides the section when none exist', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCopyLink = vi.fn()
    const onShowQr = vi.fn()
    const onShareSummary = vi.fn()
    const { rerender } = render(<ShareActivityMenu groupName="Cabin" live onClose={onClose} onCopyLink={onCopyLink} onShareSummary={onShareSummary} />)

    expect(screen.getByText('Includes every expense, payment, and balance, plus the Live QR invite.')).toBeVisible()

    rerender(<ShareActivityMenu groupName="Cabin" live onClose={onClose} onShowQr={onShowQr} />)
    expect(screen.queryByRole('button', { name: 'Copy live invite link' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show live QR' }))
    expect(onShowQr).toHaveBeenCalledOnce()

    rerender(<ShareActivityMenu groupName="Cabin" live onClose={onClose} />)
    expect(screen.queryByText('Invite people to edit live')).not.toBeInTheDocument()

    rerender(<ShareActivityMenu groupName="Cabin" onClose={onClose} onCopyLink={onCopyLink} />)
    expect(screen.queryByRole('button', { name: 'Copy live invite link' })).not.toBeInTheDocument()
  })
})
