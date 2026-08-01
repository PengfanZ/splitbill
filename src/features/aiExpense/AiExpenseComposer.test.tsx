import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Member } from '../../domain/models'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { AiExpenseApiError, type AiExpenseClient } from './aiExpenseApi'
import type { AiExpenseReadyDraft } from './aiExpenseContract'
import { AiExpenseComposer } from './AiExpenseComposer'

const members: Member[] = [
  { id: 'me', name: 'Alex', initials: 'A', color: '#fff' },
  { id: 'maya', name: 'Maya', initials: 'M', color: '#eee' },
]

const draft: AiExpenseReadyDraft = {
  status: 'ready',
  title: 'Dinner',
  amountCents: 3000,
  payerId: 'maya',
  splitMethod: 'equal',
  participantIds: ['me', 'maya'],
  exactSharesCents: [],
}

function renderComposer(client: AiExpenseClient, onDraft = vi.fn(), onClose = vi.fn()) {
  return {
    onDraft,
    onClose,
    ...render(
      <LocalizationProvider>
        <AiExpenseComposer client={client} currency="USD" members={members} onClose={onClose} onDraft={onDraft} />
      </LocalizationProvider>,
    ),
  }
}

describe('AI expense composer', () => {
  it('creates a reviewable draft without saving it', async () => {
    const user = userEvent.setup()
    let resolveDraft!: (value: typeof draft) => void
    const parse = vi.fn(() => new Promise<typeof draft>(resolve => { resolveDraft = resolve }))
    const { onDraft } = renderComposer({ parse })

    expect(screen.getByText('Tell Tally what happened')).toBeVisible()
    const description = screen.getByLabelText('Expense description')
    await user.type(description, 'Maya paid $30 for dinner, split with me')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    const workingButton = screen.getByRole('button', { name: /Creating draft/ })
    expect(workingButton).toBeDisabled()
    resolveDraft(draft)

    expect(await screen.findByText('Tell Tally what happened')).toBeVisible()
    expect(onDraft).toHaveBeenCalledWith(draft)
    expect(parse).toHaveBeenCalledWith({
      text: 'Maya paid $30 for dinner, split with me',
      locale: 'en',
      currency: 'USD',
      members: [{ id: 'me', name: 'Alex' }, { id: 'maya', name: 'Maya' }],
    })
  })

  it('asks an instant clarification and calls AI only after the missing detail is supplied', async () => {
    const user = userEvent.setup()
    const parse = vi.fn().mockResolvedValue(draft)
    const { onDraft } = renderComposer({ parse })

    await user.type(screen.getByLabelText('Expense description'), 'dinner')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    expect(await screen.findByText('Please add the total amount, who paid, and who should be included in the split.')).toBeVisible()
    expect(parse).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Your answer'), 'Maya paid $30, split with me and Maya')
    await user.click(screen.getByRole('button', { name: /Update draft/ }))
    expect(onDraft).toHaveBeenCalledWith(draft)
    expect(parse).toHaveBeenCalledOnce()
    expect(parse.mock.calls[0][0]).toMatchObject({
      text: 'dinner',
      clarifications: [{
        question: 'Please add the total amount, who paid, and who should be included in the split.',
        answer: 'Maya paid $30, split with me and Maya',
      }],
    })
  })

  it('keeps every prior answer when the model needs more than one clarification', async () => {
    const user = userEvent.setup()
    const parse = vi.fn()
      .mockResolvedValueOnce({ status: 'needs_clarification', question: 'Who paid?' })
      .mockResolvedValueOnce({ status: 'needs_clarification', question: 'Who should share it?' })
      .mockResolvedValueOnce(draft)
    const { onDraft } = renderComposer({ parse })

    await user.type(screen.getByLabelText('Expense description'), 'Dinner was $30')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    expect(await screen.findByText('Who paid?')).toBeVisible()
    await user.type(screen.getByLabelText('Your answer'), 'Maya paid')
    await user.click(screen.getByRole('button', { name: /Update draft/ }))
    expect(await screen.findByText('Who should share it?')).toBeVisible()
    await user.type(screen.getByLabelText('Your answer'), 'Alex and Maya')
    await user.click(screen.getByRole('button', { name: /Update draft/ }))

    expect(parse).toHaveBeenCalledTimes(3)
    expect(parse).toHaveBeenNthCalledWith(2, expect.objectContaining({
      text: 'Dinner was $30',
      clarifications: [{ question: 'Who paid?', answer: 'Maya paid' }],
    }))
    expect(parse).toHaveBeenNthCalledWith(3, expect.objectContaining({
      text: 'Dinner was $30',
      clarifications: [
        { question: 'Who paid?', answer: 'Maya paid' },
        { question: 'Who should share it?', answer: 'Alex and Maya' },
      ],
    }))
    expect(onDraft).toHaveBeenCalledWith(draft)
  })

  it('clears clarification when the original description changes', async () => {
    const user = userEvent.setup()
    const parse = vi.fn()
    renderComposer({ parse })
    const description = screen.getByLabelText('Expense description')
    await user.type(description, 'dinner')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    expect(await screen.findByText('Please add the total amount, who paid, and who should be included in the split.')).toBeVisible()
    await user.type(description, ' Maya paid')
    expect(screen.queryByText('Please add the total amount, who paid, and who should be included in the split.')).not.toBeInTheDocument()
  })

  it.each([
    [new AiExpenseApiError('rate-limit', 'busy'), 'The free AI model is busy.'],
    [new AiExpenseApiError('model-unavailable', 'down'), 'The free AI model and its low-cost backup both failed'],
    [new AiExpenseApiError('credits', 'credits'), "Tally's AI credits are unavailable"],
    [new AiExpenseApiError('invalid-input', 'invalid'), 'Tally could not turn that into a reliable draft.'],
    [new AiExpenseApiError('invalid-response', 'invalid'), 'Tally could not turn that into a reliable draft.'],
    [new AiExpenseApiError('unavailable', 'offline'), 'The free AI model is unavailable'],
    [new Error('unknown'), 'The free AI model is unavailable'],
  ])('shows a safe, actionable error for %s', async (error, expected) => {
    const user = userEvent.setup()
    renderComposer({ parse: vi.fn().mockRejectedValue(error) })
    await user.type(screen.getByLabelText('Expense description'), 'Maya paid $30, split with me')
    await user.click(screen.getByRole('button', { name: /Create draft/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(expected)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps cancel and disabled states predictable', async () => {
    const user = userEvent.setup()
    const { onClose } = renderComposer({ parse: vi.fn() })
    expect(screen.getByRole('button', { name: /Create draft/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Expense description'), { target: { value: 'x'.repeat(1_100) } })
    expect(screen.getByLabelText('Expense description')).toHaveValue('x'.repeat(1_100))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
