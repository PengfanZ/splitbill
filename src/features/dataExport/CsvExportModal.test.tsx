import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import { CsvExportModal } from './CsvExportModal'

const group: ActivityGroup = { id: 'trip', name: 'Weekend trip', emoji: '✦', memberIds: ['me', 'maya'], currency: 'USD' }
const members: Member[] = [
  { id: 'me', name: 'Alex', initials: 'A', color: '#111' },
  { id: 'maya', name: 'Maya', initials: 'M', color: '#222' },
]
const expenses: Expense[] = [
  { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 30, payerId: 'me', splitMethod: 'equal', shares: { me: 15, maya: 15 }, createdAt: '2026-08-20T23:30:00.000Z' },
  { id: 'taxi', groupId: 'trip', title: 'Taxi', amount: 10, payerId: 'maya', splitMethod: 'equal', shares: { me: 5, maya: 5 }, createdAt: '2026-08-21T01:00:00.000Z' },
  { id: 'payment', groupId: 'trip', title: 'Settlement payment', amount: 3, payerId: 'maya', splitMethod: 'exact', shares: { me: 3 }, createdAt: '2026-08-21T02:00:00.000Z', kind: 'settlement' },
]

afterEach(() => {
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
  vi.restoreAllMocks()
})

describe('CSV export modal', () => {
  it('previews the current person, switches members and scopes, then downloads', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDownloaded = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    render(<CsvExportModal group={group} members={members} expenses={expenses} currentMemberId="maya" onClose={onClose} onDownloaded={onDownloaded} />)

    expect(screen.getByRole('dialog', { name: 'Export CSV data' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Person to export' })).toHaveTextContent('Maya')
    expect(screen.getByText('Personal spending').nextSibling).toHaveTextContent('$20.00')
    expect(screen.getByText('Settlement flow').nextSibling).toHaveTextContent('−$3.00')

    await user.click(screen.getByRole('button', { name: 'Person to export' }))
    await user.click(screen.getByRole('option', { name: 'Alex' }))
    expect(screen.getByText('Paid upfront').nextSibling).toHaveTextContent('$30.00')
    expect(screen.getByText('Settlement flow').nextSibling).toHaveTextContent('+$3.00')

    await user.click(screen.getByRole('button', { name: /Full activity/ }))
    expect(screen.queryByRole('button', { name: 'Person to export' })).not.toBeInTheDocument()
    expect(screen.getByText('Expenses').nextSibling).toHaveTextContent('2')
    expect(screen.getByText('People').nextSibling).toHaveTextContent('2')
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    await user.click(screen.getByRole('button', { name: /One person/ }))
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))

    await waitFor(() => expect(onDownloaded.mock.calls).toEqual([[{ type: 'activity' }], [{ type: 'member', memberId: 'me' }]]))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('falls back to the first member and disables empty exports', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { rerender } = render(<CsvExportModal group={group} members={members} expenses={[]} currentMemberId="missing" onClose={onClose} />)

    expect(screen.getByRole('button', { name: 'Person to export' })).toHaveTextContent('Alex')
    expect(screen.getByRole('alert')).toHaveTextContent('There is no data')
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()

    rerender(<CsvExportModal group={group} members={[]} expenses={[]} onClose={onClose} />)
    expect(screen.queryByRole('button', { name: 'Person to export' })).not.toBeInTheDocument()
  })

  it('keeps the selected id when members refresh and still exports matching rows', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const { rerender } = render(<CsvExportModal group={group} members={members} expenses={expenses} currentMemberId="maya" onClose={onClose} />)

    rerender(<CsvExportModal group={group} members={[members[0]]} expenses={expenses} currentMemberId="me" onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Download CSV' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('uses the native share sheet in an installed PWA and stays usable after cancellation', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onDownloaded = vi.fn()
    const share = vi.fn().mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError')).mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<CsvExportModal group={group} members={members} expenses={expenses} currentMemberId="me" onClose={onClose} onDownloaded={onDownloaded} />)

    const exportButton = screen.getByRole('button', { name: 'Save or share CSV' })
    await user.click(exportButton)
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(onClose).not.toHaveBeenCalled()
    expect(onDownloaded).not.toHaveBeenCalled()
    expect(exportButton).toBeEnabled()
    expect(anchorClick).not.toHaveBeenCalled()

    await user.click(exportButton)
    await waitFor(() => expect(onDownloaded).toHaveBeenCalledWith({ type: 'member', memberId: 'me' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(anchorClick).not.toHaveBeenCalled()
  })

  it('shows an actionable error without closing when every delivery path fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('blocked') })
    render(<CsvExportModal group={group} members={members} expenses={expenses} currentMemberId="me" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Download CSV' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Tally could not export this CSV. Try again.')
    expect(screen.getByRole('dialog', { name: 'Export CSV data' })).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()
  })
})
