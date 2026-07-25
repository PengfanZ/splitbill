import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ShareActivityMenu } from './ShareActivityMenu'

describe('ShareActivityMenu', () => {
  it('presents every local sharing path and forwards the selected action', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCollaborateLive = vi.fn()
    const onCopyLink = vi.fn()
    const onShowQr = vi.fn()
    const onShareSummary = vi.fn()
    render(<ShareActivityMenu
      groupName="Weekend trip"
      onClose={onClose}
      onCollaborateLive={onCollaborateLive}
      onCopyLink={onCopyLink}
      onShowQr={onShowQr}
      onShareSummary={onShareSummary}
    />)

    expect(screen.getByRole('dialog', { name: 'Share activity' })).toBeVisible()
    expect(screen.getByText('First choose what people should be able to do in Weekend trip.')).toBeVisible()
    expect(screen.getByText('VIEW ONLY')).toBeVisible()
    expect(screen.getByText('CAN EDIT · STAYS IN SYNC')).toBeVisible()
    expect(screen.getByText('Later changes won’t appear.', { exact: false })).toBeVisible()
    expect(screen.getByText('everyone sees the latest version.', { exact: false })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Start live activity' }))
    await user.click(screen.getByRole('button', { name: 'Copy snapshot link' }))
    await user.click(screen.getByRole('button', { name: 'Show snapshot QR' }))
    await user.click(screen.getByRole('button', { name: /^Share balances only/ }))

    expect(onCollaborateLive).toHaveBeenCalledOnce()
    expect(onCopyLink).toHaveBeenCalledOnce()
    expect(onShowQr).toHaveBeenCalledOnce()
    expect(onShareSummary).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('uses the live-link action, omits unavailable actions, and supports every close path', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCopyLink = vi.fn().mockResolvedValue(undefined)
    const { container } = render(<ShareActivityMenu groupName="Cabin" live onClose={onClose} onCopyLink={onCopyLink} />)

    expect(screen.getByText('Invite people to edit live')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy live invite link' })).toBeVisible()
    expect(screen.queryByText('Send a frozen copy')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start live activity' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show live QR' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy live invite link' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.mouseDown(container.querySelector('.share-menu')!)
    fireEvent.mouseDown(container.querySelector('.share-menu-backdrop')!)
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCopyLink).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('renders snapshot and live delivery methods independently when only one is available', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCopyLink = vi.fn()
    const onShowQr = vi.fn()
    const { rerender } = render(<ShareActivityMenu groupName="Cabin" onClose={onClose} onCopyLink={onCopyLink} />)

    expect(screen.getByRole('button', { name: 'Copy snapshot link' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Show snapshot QR' })).not.toBeInTheDocument()

    rerender(<ShareActivityMenu groupName="Cabin" live onClose={onClose} onShowQr={onShowQr} />)
    expect(screen.queryByRole('button', { name: 'Copy live invite link' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show live QR' }))
    expect(onShowQr).toHaveBeenCalledOnce()

    rerender(<ShareActivityMenu groupName="Cabin" live onClose={onClose} />)
    expect(screen.queryByText('Invite people to edit live')).not.toBeInTheDocument()
  })
})
