import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityGroup, Member } from '../../domain/models'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { receiptDraftFixture } from './receiptContract.test'
import { prepareReceiptImage } from './receiptImage'
import { ReceiptSplitFlow, receiptSplitTestables } from './ReceiptSplitFlow'

vi.mock('./receiptImage', () => ({ prepareReceiptImage: vi.fn() }))

const members: Member[] = [
  { id: 'a', name: 'Avery', initials: 'A', color: '#111' },
  { id: 'b', name: 'Blair', initials: 'B', color: '#222' },
  { id: 'c', name: 'Casey', initials: 'C', color: '#333' },
]
const group: ActivityGroup = {
  id: 'group-1', name: 'Dinner', emoji: '🍜', memberIds: members.map(member => member.id), currency: 'USD',
}

function renderFlow(options: {
  draft?: typeof receiptDraftFixture
  locale?: 'en' | 'zh-CN'
  parseError?: Error
} = {}) {
  const onBackToManual = vi.fn()
  const onSave = vi.fn()
  const onConfirmed = vi.fn()
  const parse = options.parseError
    ? vi.fn().mockRejectedValue(options.parseError)
    : vi.fn().mockResolvedValue(options.draft ?? receiptDraftFixture)
  const view = render(
    <LocalizationProvider initialLocale={options.locale ?? 'en'}>
      <ReceiptSplitFlow client={{ parse }} group={group} members={members} onBackToManual={onBackToManual} onConfirmed={onConfirmed} onSave={onSave} />
    </LocalizationProvider>,
  )
  return { ...view, onBackToManual, onConfirmed, onSave, parse }
}

async function uploadReceipt(container: HTMLElement) {
  const user = userEvent.setup()
  const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]')
  await user.upload(inputs[1], new File(['photo'], 'receipt.jpg', { type: 'image/jpeg' }))
  return user
}

beforeEach(() => {
  vi.mocked(prepareReceiptImage).mockResolvedValue({
    dataUrl: 'data:image/jpeg;base64,QQ==', width: 1, height: 1,
  })
})

describe('receipt split flow', () => {
  it('keeps manual entry available and handles an empty file selection', async () => {
    const user = userEvent.setup()
    const { container, onBackToManual, parse } = renderFlow()
    expect(screen.getByText('Add a clear receipt photo')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onBackToManual).toHaveBeenCalledOnce()
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [] } })
    expect(parse).not.toHaveBeenCalled()
  })

  it('opens both camera inputs from the visible photo controls', async () => {
    const user = userEvent.setup()
    const { container } = renderFlow()
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="file"]')
    const cameraClick = vi.spyOn(inputs[0], 'click')
    const libraryClick = vi.spyOn(inputs[1], 'click')
    const cameraButtons = screen.getAllByRole('button', { name: /Take photo/ })
    await user.click(cameraButtons[0])
    await user.click(cameraButtons[1])
    await user.click(screen.getByRole('button', { name: /Choose from library/ }))
    expect(cameraClick).toHaveBeenCalledTimes(2)
    expect(libraryClick).toHaveBeenCalledOnce()
  })

  it('reviews, assigns, allocates, tips, and saves one exact expense', async () => {
    const { container, onConfirmed, onSave, parse } = renderFlow()
    const user = await uploadReceipt(container)

    expect(await screen.findByText('Review the receipt')).toBeVisible()
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en', currency: 'USD' }))
    await user.click(screen.getByRole('button', { name: 'Show receipt details for Ramen' }))
    expect(screen.getByText('Ramen 18.00')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Hide receipt details for Ramen' }))
    expect(screen.queryByText('Ramen 18.00')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Assign dishes' }))

    await user.click(screen.getByRole('button', { name: 'Assign Ramen to Avery' }))
    await user.click(screen.getByRole('button', { name: 'Assign Bao to Blair' }))
    await user.click(screen.getByRole('button', { name: 'Assign Bao to Casey' }))
    expect(screen.getByText('2 selected')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Review split' }))

    await user.click(screen.getByRole('button', { name: 'Paid by' }))
    await user.click(screen.getByRole('option', { name: 'Blair' }))
    await user.click(screen.getByRole('button', { name: 'Tax 8% Charge allocation' }))
    await user.click(screen.getByRole('option', { name: 'Equal among diners' }))
    await user.clear(screen.getByLabelText('Tip percentage'))
    await user.type(screen.getByLabelText('Tip percentage'), '10')
    expect(screen.getByText('$37.76')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add receipt expense' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 'group-1',
      title: 'Bao Button',
      amount: 37.76,
      payerId: 'b',
      splitMethod: 'exact',
      shares: { a: 22.86, b: 7.45, c: 7.45 },
    }))
    expect(onConfirmed).toHaveBeenCalledOnce()
  })

  it('lets the user edit receipt lines and requires exact reconciliation', async () => {
    const mismatch = { ...receiptDraftFixture, totalCents: 3_500 }
    const { container } = renderFlow({ draft: mismatch })
    const user = await uploadReceipt(container)
    expect(await screen.findByText('The item and charge amounts do not match the printed totals. Fix the highlighted amounts before continuing.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Assign dishes' })).toBeDisabled()

    await user.clear(screen.getByLabelText('Receipt total'))
    await user.type(screen.getByLabelText('Receipt total'), '34.56')
    await user.clear(screen.getByLabelText('Subtotal'))
    await user.type(screen.getByLabelText('Subtotal'), '32.01')
    expect(screen.getByRole('button', { name: 'Assign dishes' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Subtotal'))
    await user.type(screen.getByLabelText('Subtotal'), '32')
    await user.clear(screen.getByLabelText('Ramen amount'))
    await user.type(screen.getByLabelText('Ramen amount'), '20.01')
    expect(screen.getByRole('button', { name: 'Assign dishes' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Ramen amount'))
    await user.type(screen.getByLabelText('Ramen amount'), '20')
    await user.clear(screen.getAllByLabelText('Item name')[0])
    await user.type(screen.getAllByLabelText('Item name')[0], 'Noodles')
    expect(screen.getByRole('button', { name: 'Assign dishes' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Choose another photo' }))
    expect(screen.getByText('Add a clear receipt photo')).toBeVisible()
  })

  it('requires acknowledgment of unresolved lines and blocks a currency mismatch', async () => {
    const needsReview = {
      ...receiptDraftFixture,
      currency: 'CNY' as const,
      unresolvedLines: ['Mystery fee 1.00'],
    }
    const { container } = renderFlow({ draft: needsReview, locale: 'zh-CN' })
    const user = await uploadReceipt(container)
    expect(await screen.findByText('Mystery fee 1.00')).toBeVisible()
    expect(screen.getByText(/活动使用美元/)).toBeVisible()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: '分配菜品' })).toBeDisabled()
  })

  it('shows actionable capture errors and supports retry', async () => {
    const { container } = renderFlow({ parseError: new Error('The receipt AI models are busy. Try again shortly.') })
    await uploadReceipt(container)
    expect(await screen.findByRole('alert')).toHaveTextContent('The receipt AI models are busy')
    await userEvent.click(screen.getByRole('button', { name: 'Choose another photo' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    vi.mocked(prepareReceiptImage).mockRejectedValueOnce('unknown')
    await uploadReceipt(container)
    expect(await screen.findByRole('alert')).toHaveTextContent('Tally could not read this receipt')
  })

  it('supports backtracking, unassigning, charge edits, and an already-charged tip', async () => {
    const tipDraft = {
      ...receiptDraftFixture,
      charges: [
        ...receiptDraftFixture.charges,
        { id: 'tip', type: 'tip' as const, label: 'Tip', amountCents: 300, rateBasisPoints: null, confidence: 'high' as const },
      ],
      totalCents: 3_756,
    }
    const { container } = renderFlow({ draft: tipDraft })
    const user = await uploadReceipt(container)
    await screen.findByText('Review the receipt')
    await user.clear(screen.getByLabelText('Tax 8% amount'))
    await user.type(screen.getByLabelText('Tax 8% amount'), '2.56')
    await user.click(screen.getByRole('button', { name: 'Assign dishes' }))
    await user.click(screen.getByRole('button', { name: 'Assign Ramen to Avery' }))
    await user.click(screen.getByRole('button', { name: 'Assign Ramen to Avery' }))
    expect(screen.getAllByText('Assign every dish before continuing.').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Review the receipt' }))
    await user.click(screen.getByRole('button', { name: 'Assign dishes' }))
    await user.click(screen.getByRole('button', { name: 'Assign Ramen to Avery' }))
    await user.click(screen.getByRole('button', { name: 'Assign Bao to Blair' }))
    await user.click(screen.getByRole('button', { name: 'Review split' }))
    expect(screen.getByLabelText('Tip percentage')).toBeDisabled()
    expect(screen.getByText('A charged tip is already included on this receipt.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Tax 8% Charge allocation' }))
    await user.click(screen.getByRole('option', { name: 'Equal among diners' }))
    await user.click(screen.getByRole('button', { name: 'Who had what?' }))
    expect(screen.getByText('Who had what?')).toBeVisible()
  })

  it('handles low-confidence, missing merchant, nullable details, and a receipt without charges', async () => {
    const simpleDraft = {
      ...receiptDraftFixture,
      merchant: null,
      items: [{
        ...receiptDraftFixture.items[0],
        confidence: 'low' as const,
        details: [{ kind: 'note' as const, label: 'No onions', amountCents: null }],
        sourceLines: [],
      }, {
        ...receiptDraftFixture.items[1],
        details: [],
        sourceLines: [],
      }],
      charges: [],
      subtotalCents: 3_200,
      totalCents: 3_200,
      unresolvedLines: ['Unread line'],
    }
    const { container, onSave } = renderFlow({ draft: simpleDraft })
    const user = await uploadReceipt(container)
    await screen.findByText('Review the receipt')
    expect(container.querySelector('.receipt-line--check')).toBeTruthy()
    expect(screen.queryByText('Tax & charges')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show receipt details for Bao' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show receipt details for Ramen' }))
    expect(screen.getByText('No onions')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Assign dishes' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Assign dishes' }))
    await user.click(screen.getByRole('button', { name: 'Assign Ramen to Avery' }))
    await user.click(screen.getByRole('button', { name: 'Assign Bao to Blair' }))
    await user.click(screen.getByRole('button', { name: 'Review split' }))
    expect(screen.getByLabelText('Expense name')).toHaveValue('Split a receipt')
    expect(screen.queryByText('Charge allocation')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Tip percentage'), '200')
    expect(screen.getByLabelText('Tip percentage')).toHaveValue(100)
    fireEvent.change(screen.getByLabelText('Tip percentage'), { target: { value: '-5' } })
    expect(screen.getByLabelText('Tip percentage')).toHaveValue(0)
    await user.clear(screen.getByLabelText('Expense name'))
    await user.type(screen.getByLabelText('Expense name'), 'Lunch receipt')
    await user.click(screen.getByRole('button', { name: 'Add receipt expense' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Lunch receipt', amount: 32 }))
  })

  it('blocks confirmation if deterministic allocation rejects invalid activity members', async () => {
    const duplicateMembers = [members[0], { ...members[0] }]
    const { container } = render(
      <LocalizationProvider initialLocale="en">
        <ReceiptSplitFlow client={{ parse: vi.fn().mockResolvedValue(receiptDraftFixture) }} group={group} members={duplicateMembers} onBackToManual={vi.fn()} onSave={vi.fn()} />
      </LocalizationProvider>,
    )
    const user = await uploadReceipt(container)
    await screen.findByText('Review the receipt')
    await user.click(screen.getByRole('button', { name: 'Assign dishes' }))
    await user.click(screen.getAllByRole('button', { name: 'Assign Ramen to Avery' })[0])
    await user.click(screen.getAllByRole('button', { name: 'Assign Bao to Avery' })[0])
    expect(screen.getByRole('button', { name: 'Review split' })).toBeDisabled()
  })

  it('saves safely without a confirmation analytics callback', async () => {
    const draft = {
      ...receiptDraftFixture,
      items: [receiptDraftFixture.items[0]],
      charges: [],
      subtotalCents: 2_000,
      totalCents: 2_000,
    }
    const onSave = vi.fn()
    const { container } = render(
      <LocalizationProvider initialLocale="en">
        <ReceiptSplitFlow client={{ parse: vi.fn().mockResolvedValue(draft) }} group={group} members={[members[0]]} onBackToManual={vi.fn()} onSave={onSave} />
      </LocalizationProvider>,
    )
    const user = await uploadReceipt(container)
    await screen.findByText('Review the receipt')
    await user.click(screen.getByRole('button', { name: 'Assign dishes' }))
    await user.click(screen.getByRole('button', { name: 'Assign Ramen to Avery' }))
    await user.click(screen.getByRole('button', { name: 'Review split' }))
    await user.click(screen.getByRole('button', { name: 'Add receipt expense' }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('covers receipt value helpers', () => {
    expect(receiptSplitTestables.amountInput(123)).toBe('1.23')
    expect(receiptSplitTestables.centsFromInput('bad')).toBe(0)
    expect(receiptSplitTestables.centsFromInput('-1')).toBe(0)
    expect(receiptSplitTestables.chargeSettings(receiptDraftFixture)[0].allocationMethod).toBe('proportional')
    expect(receiptSplitTestables.buildTipCharge(receiptDraftFixture, 0)).toBeNull()
    expect(receiptSplitTestables.buildTipCharge({
      ...receiptDraftFixture,
      charges: [{ ...receiptDraftFixture.charges[0], type: 'tip' }],
    }, 10)).toBeNull()
    expect(receiptSplitTestables.buildTipCharge(receiptDraftFixture, 10)).toMatchObject({ amountCents: 320, rateBasisPoints: 1_000 })
  })

  it('does not save with a missing split and survives an empty member list', async () => {
    const onSave = vi.fn()
    render(
      <LocalizationProvider initialLocale="en">
        <ReceiptSplitFlow client={{ parse: vi.fn() }} group={group} members={[]} onBackToManual={vi.fn()} onSave={onSave} saving />
      </LocalizationProvider>,
    )
    expect(screen.getByText('Add a clear receipt photo')).toBeVisible()
    await waitFor(() => expect(onSave).not.toHaveBeenCalled())
  })
})
