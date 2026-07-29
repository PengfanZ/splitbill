import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LiveActivityQrModal } from './LiveActivityQrModal'

describe('LiveActivityQrModal', () => {
  it('renders a scannable Live link and forwards every action', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCopy = vi.fn()
    const onShare = vi.fn()
    render(
      <LiveActivityQrModal
        groupName="Weekend"
        url="https://example.com/splitbill/#live=code.token"
        activityCode="A1B2C3D4E5"
        onClose={onClose}
        onCopy={onCopy}
        onShare={onShare}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Scan to join Weekend' })).toBeVisible()
    expect(screen.getByLabelText('Weekend shared activity QR code').querySelector('svg')).toBeTruthy()
    expect(screen.getByTitle('Weekend shared activity QR code')).toBeInTheDocument()
    expect(screen.getByText('Live activity · A1B2C3D4E5')).toBeVisible()
    expect(screen.getByText('The code opens the same editable activity on Tally.')).toBeVisible()
    expect(screen.getByText('Anyone with the link can edit')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    await user.click(screen.getByRole('button', { name: 'Share link' }))
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(onCopy).toHaveBeenCalledOnce()
    expect(onShare).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('omits the activity code suffix when one is unavailable', () => {
    render(
      <LiveActivityQrModal
        groupName="Weekend"
        url="https://example.com"
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onShare={vi.fn()}
      />,
    )

    expect(screen.getByText('Live activity')).toBeVisible()
  })
})
