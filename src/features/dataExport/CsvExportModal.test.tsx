import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import { CsvExportModal } from './CsvExportModal'

const group: ActivityGroup = { id: 'trip', name: 'Weekend trip', emoji: '✦', memberIds: ['me', 'maya'], currency: 'USD' }
const members: Member[] = [
  { id: 'me', name: 'Alex', initials: 'A', color: '#111' },
  { id: 'maya', name: 'Maya', initials: 'M', color: '#222' },
]
const expenses: Expense[] = [
  { id: 'dinner', groupId: 'trip', title: 'Dinner', amount: 30, payerId: 'me', splitMethod: 'equal', shares: { me: 15, maya: 15 }, createdAt: '2026-08-20T23:30:00.000Z', category: 'food' },
  { id: 'taxi', groupId: 'trip', title: 'Taxi', amount: 10, payerId: 'maya', splitMethod: 'equal', shares: { me: 5, maya: 5 }, createdAt: '2026-08-21T01:00:00.000Z', category: 'transport' },
  { id: 'payment', groupId: 'trip', title: 'Settlement payment', amount: 3, payerId: 'maya', splitMethod: 'exact', shares: { me: 3 }, createdAt: '2026-08-21T02:00:00.000Z', kind: 'settlement' },
]

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
    expect(screen.getByText('Food & dining')).toBeVisible()
    expect(screen.getByText('Transport')).toBeVisible()

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

    expect(onDownloaded.mock.calls).toEqual([[{ type: 'activity' }], [{ type: 'member', memberId: 'me' }]])
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
})
