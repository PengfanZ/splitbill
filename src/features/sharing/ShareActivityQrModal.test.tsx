import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ShareActivityQrModal } from './ShareActivityQrModal'

describe('ShareActivityQrModal', () => {
  it('renders a scannable website QR code and forwards both actions', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onCopy = vi.fn()
    render(
      <ShareActivityQrModal
        groupName="Weekend"
        url="https://example.com/splitbill/#share=activity"
        onClose={onClose}
        onCopy={onCopy}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Scan to open Weekend' })).toBeVisible()
    expect(screen.getByLabelText('Weekend shared activity QR code').querySelector('svg')).toBeTruthy()
    expect(screen.getByTitle('Weekend shared activity QR code')).toBeInTheDocument()
    expect(screen.getByText('The code opens a read-only snapshot of this activity on Tally.')).toBeVisible()
    expect(screen.getByText('It is not encrypted.', { exact: false })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(onCopy).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
