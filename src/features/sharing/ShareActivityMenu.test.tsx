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
    expect(screen.getByText('Choose how you want to share Weekend trip.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Collaborate live/ }))
    await user.click(screen.getByRole('button', { name: /^Copy link/ }))
    await user.click(screen.getByRole('button', { name: /^Show QR code/ }))
    await user.click(screen.getByRole('button', { name: /^Share summary/ }))

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

    expect(screen.getByRole('button', { name: /^Copy live link/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /^Collaborate live/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Show QR code/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Copy live link/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.mouseDown(container.querySelector('.share-menu')!)
    fireEvent.mouseDown(container.querySelector('.share-menu-backdrop')!)
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCopyLink).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledTimes(4)
  })
})
