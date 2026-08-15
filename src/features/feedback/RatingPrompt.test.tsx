import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { FeedbackApiError, type FeedbackClient } from './feedbackApi'
import { RatingPrompt } from './RatingPrompt'

function renderPrompt({
  client = { submit: vi.fn().mockResolvedValue(undefined) },
  onAddNote = vi.fn(),
  onDismiss = vi.fn(),
  onSubmitted = vi.fn(),
}: {
  client?: Pick<FeedbackClient, 'submit'>
  onAddNote?: (rating: 1 | 2 | 3 | 4 | 5 | null) => void
  onDismiss?: () => void
  onSubmitted?: () => void
} = {}) {
  return {
    client,
    onAddNote,
    onDismiss,
    onSubmitted,
    ...render(
      <LocalizationProvider initialLocale="en">
        <RatingPrompt
          client={client}
          onAddNote={onAddNote}
          onDismiss={onDismiss}
          onSubmitted={onSubmitted}
          release="2026-08-live-controls"
          surface="local"
        />
      </LocalizationProvider>,
    ),
  }
}

describe('RatingPrompt', () => {
  it('keeps the prompt open after a star is chosen and submits rating only on request', async () => {
    const user = userEvent.setup()
    const submit = vi.fn().mockResolvedValue(undefined)
    const onSubmitted = vi.fn()
    renderPrompt({ client: { submit }, onSubmitted })

    expect(screen.getByLabelText('How was Tally?')).toBeVisible()
    await user.click(screen.getByRole('radio', { name: 'Rate 5 out of 5' }))

    expect(submit).not.toHaveBeenCalled()
    expect(onSubmitted).not.toHaveBeenCalled()
    expect(screen.getByText('Want to tell us more?')).toBeVisible()
    expect(screen.getByLabelText('How was Tally?')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Send rating only' }))

    expect(submit).toHaveBeenCalledWith({
      category: 'general',
      message: '',
      locale: 'en',
      rating: 5,
      release: '2026-08-live-controls',
      surface: 'local',
    })
    expect(onSubmitted).toHaveBeenCalledOnce()
    expect(JSON.stringify(submit.mock.calls[0])).not.toMatch(/activity|expense|member|#live=/i)
  })

  it('can be dismissed or expanded into the full feedback form', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const onAddNote = vi.fn()
    renderPrompt({ onDismiss, onAddNote })

    await user.click(screen.getByRole('button', { name: 'Add a note' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onAddNote).toHaveBeenCalledWith(null)
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('carries the selected rating into the optional note flow', async () => {
    const user = userEvent.setup()
    const onAddNote = vi.fn()
    renderPrompt({ onAddNote })

    await user.click(screen.getByRole('radio', { name: 'Rate 4 out of 5' }))
    await user.click(screen.getByRole('button', { name: 'Add a note' }))

    expect(onAddNote).toHaveBeenCalledWith(4)
  })

  it.each([
    [new FeedbackApiError('rate-limit', 'limited'), 'You’ve sent several notes recently.'],
    [new Error('offline'), 'Feedback is temporarily unavailable.'],
  ])('keeps the prompt retryable after %s', async (error, message) => {
    const user = userEvent.setup()
    renderPrompt({ client: { submit: vi.fn().mockRejectedValue(error) } })

    await user.click(screen.getByRole('radio', { name: 'Rate 2 out of 5' }))
    await user.click(screen.getByRole('button', { name: 'Send rating only' }))
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('radio', { name: 'Rate 2 out of 5' })).toBeChecked()
  })

  it('disables prompt actions while the rating is being sent', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    const onSubmitted = vi.fn()
    renderPrompt({
      client: { submit: vi.fn(() => new Promise<void>(resolve => { finish = resolve })) },
      onSubmitted,
    })

    await user.click(screen.getByRole('radio', { name: 'Rate 4 out of 5' }))
    await user.click(screen.getByRole('button', { name: 'Send rating only' }))
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add a note' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled()
    finish()
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce())
  })
})
