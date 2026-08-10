import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { FeedbackModal } from './FeedbackModal'
import { FeedbackApiError, type FeedbackClient } from './feedbackApi'

function renderModal({
  client = { submit: vi.fn().mockResolvedValue(undefined) },
  onClose = vi.fn(),
  onSubmitted = vi.fn(),
}: {
  client?: Pick<FeedbackClient, 'submit'> | null
  onClose?: () => void
  onSubmitted?: () => void
} = {}) {
  return {
    client,
    onClose,
    onSubmitted,
    ...render(
      <LocalizationProvider initialLocale="en">
        <FeedbackModal
          client={client}
          onClose={onClose}
          onSubmitted={onSubmitted}
          release="2026-08-live-controls"
          surface="live"
        />
      </LocalizationProvider>,
    ),
  }
}

describe('FeedbackModal', () => {
  it('submits a selected category without activity details', async () => {
    const user = userEvent.setup()
    const submit = vi.fn().mockResolvedValue(undefined)
    const onSubmitted = vi.fn()
    renderModal({ client: { submit }, onSubmitted })

    expect(screen.getByRole('dialog', { name: 'What should Tally do better?' })).toBeVisible()
    expect(screen.getByRole('radio', { name: 'Rate 1 out of 5' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'General' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Rate 4 out of 5' }))
    await user.click(screen.getByRole('radio', { name: 'Idea' }))
    await user.type(screen.getByLabelText('Add a note (optional)'), 'Make mobile totals easier to scan.')
    expect(screen.getByText('34/1000')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(submit).toHaveBeenCalledWith({
      category: 'idea',
      message: 'Make mobile totals easier to scan.',
      locale: 'en',
      rating: 4,
      surface: 'live',
      release: '2026-08-live-controls',
    })
    expect(onSubmitted).toHaveBeenCalledOnce()
    expect(JSON.stringify(submit.mock.calls[0])).not.toMatch(/activity|expense|member|#live=/i)
  })

  it('submits a one-tap rating without requiring a message', async () => {
    const user = userEvent.setup()
    const submit = vi.fn().mockResolvedValue(undefined)
    renderModal({ client: { submit } })

    await user.click(screen.getByRole('radio', { name: 'Rate 5 out of 5' }))
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ message: '', rating: 5 }))
  })

  it('supports every category and both close controls', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const view = renderModal({ onClose })

    await user.click(screen.getByRole('radio', { name: 'Problem' }))
    expect(screen.getByRole('radio', { name: 'Problem' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()

    view.unmount()
    renderModal({ onClose })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps a short or unavailable submission in place', async () => {
    const user = userEvent.setup()
    const { container } = renderModal({ client: null })
    const textarea = screen.getByLabelText('Add a note (optional)')
    await user.type(textarea, 'x')
    fireEvent.submit(container.querySelector('form')!)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.type(textarea, 'yz')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Feedback is temporarily unavailable')
    expect(textarea).toHaveValue('xyz')
  })

  it.each([
    [new FeedbackApiError('rate-limit', 'limited'), 'You’ve sent several notes recently.'],
    [new FeedbackApiError('invalid-input', 'invalid'), 'Choose a rating or write at least 3 characters'],
    [new FeedbackApiError('network', 'offline'), 'Tally could not connect.'],
    [new FeedbackApiError('configuration', 'missing'), 'Feedback is temporarily unavailable.'],
    [new Error('unexpected'), 'Feedback is temporarily unavailable.'],
  ])('shows a useful retryable error for %s', async (error, message) => {
    const user = userEvent.setup()
    const submit = vi.fn().mockRejectedValue(error)
    renderModal({ client: { submit } })

    await user.type(screen.getByLabelText('Add a note (optional)'), 'Something went wrong.')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(screen.getByRole('alert')).toHaveTextContent(message)
  })

  it('clears a previous error when the user edits the message', async () => {
    const user = userEvent.setup()
    const submit = vi.fn().mockRejectedValue(new FeedbackApiError('network', 'offline'))
    renderModal({ client: { submit } })

    await user.type(screen.getByLabelText('Add a note (optional)'), 'Could be clearer.')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(screen.getByRole('alert')).toBeVisible()
    await user.type(screen.getByLabelText('Add a note (optional)'), ' More detail.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('locks the sheet while a submission is in flight', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    const submit = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const onSubmitted = vi.fn()
    renderModal({ client: { submit }, onSubmitted })

    await user.type(screen.getByLabelText('Add a note (optional)'), 'Please add a clearer empty state.')
    await user.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    finish()
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce())
  })
})
