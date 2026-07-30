import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('runs cancel and destructive confirmation actions', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(
      <ConfirmDialog
        title="Delete this?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Delete this?' })).toBeVisible()
    expect(screen.getByText('This cannot be undone.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('locks a busy primary confirmation without exposing dismissal', () => {
    render(
      <ConfirmDialog
        title="Reset?"
        description="Please wait."
        confirmLabel="Continue"
        variant="primary"
        busy
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled()
    expect(document.querySelector('.confirm-dialog-icon--primary')).toBeInTheDocument()
  })
})
