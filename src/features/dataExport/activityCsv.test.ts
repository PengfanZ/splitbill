import { describe, expect, it, vi } from 'vitest'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import {
  buildCsvExportRows,
  csvExportFilename,
  csvExportPreview,
  downloadCsv,
  memberCategoryTotals,
  serializeCsv,
} from './activityCsv'

const group: ActivityGroup = { id: 'trip', name: '上海 Trip', emoji: '✦', memberIds: ['me', 'maya'], currency: 'CNY' }
const members: Member[] = [
  { id: 'me', name: 'Alex', initials: 'A', color: '#111' },
  { id: 'maya', name: 'Maya', initials: 'M', color: '#222' },
  { id: 'other-alex', name: 'Alex', initials: 'A', color: '#333' },
]
const expenses: Expense[] = [
  {
    id: 'dinner', groupId: 'trip', title: 'Dinner, "great"\nnight', amount: 30, payerId: 'me', splitMethod: 'exact',
    shares: { me: 20, maya: 10, 'other-alex': 0 }, createdAt: '2026-08-20T23:30:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z', category: 'food',
  },
  {
    id: 'taxi', groupId: 'trip', title: 'Taxi', amount: 10, payerId: 'maya', splitMethod: 'equal',
    shares: { me: 5, maya: 5 }, createdAt: '2026-08-21T01:00:00.000Z',
  },
  {
    id: 'settlement', groupId: 'trip', title: 'Settlement payment', amount: 3, payerId: 'maya', splitMethod: 'exact',
    shares: { me: 3 }, createdAt: '2026-08-21T02:00:00.000Z', kind: 'settlement',
  },
  {
    id: 'broken-settlement', groupId: 'trip', title: 'Broken', amount: 1, payerId: 'me', splitMethod: 'exact',
    shares: { me: 1 }, createdAt: '2026-08-21T03:00:00.000Z', kind: 'settlement',
  },
]

describe('activity CSV export', () => {
  it('builds a long-form full activity export with expense and two-sided settlement rows', () => {
    const rows = buildCsvExportRows(group, members, expenses, { type: 'activity' })

    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({
      recordType: 'expense', category: 'food', expenseTotal: 30, paidBy: 'Alex', person: 'Alex',
      personShare: 20, personPaid: 30, balanceContribution: 10, currency: 'CNY', expenseId: 'dinner',
    })
    expect(rows.filter(row => row.recordType === 'settlement')).toEqual([
      expect.objectContaining({ person: 'Maya', settlementFlow: -3, settlementFrom: 'Maya', settlementTo: 'Alex' }),
      expect.objectContaining({ person: 'Alex', settlementFlow: 3, settlementFrom: 'Maya', settlementTo: 'Alex' }),
    ])
    expect(csvExportPreview(rows)).toEqual({
      rowCount: 6,
      expenseCount: 2,
      settlementCount: 1,
      personalShare: 40,
      personalPaid: 40,
      settlementFlow: 0,
    })
  })

  it('filters a personal export by member id even when two people have the same name', () => {
    const rows = buildCsvExportRows(group, members, expenses, { type: 'member', memberId: 'me' })

    expect(rows.map(row => row.expenseId)).toEqual(['dinner', 'taxi', 'settlement'])
    expect(csvExportPreview(rows)).toMatchObject({
      rowCount: 3,
      expenseCount: 2,
      settlementCount: 1,
      personalShare: 25,
      personalPaid: 30,
      settlementFlow: 3,
    })
    expect(buildCsvExportRows(group, members, expenses, { type: 'member', memberId: 'other-alex' })).toEqual([])
  })

  it('keeps a payer-only row when the payer did not participate in the split', () => {
    const payerOnlyExpense: Expense = {
      ...expenses[0],
      id: 'gift',
      payerId: 'other-alex',
      amount: 10,
      shares: { me: 10 },
    }

    expect(buildCsvExportRows(group, members, [payerOnlyExpense], { type: 'member', memberId: 'other-alex' })).toEqual([
      expect.objectContaining({ person: 'Alex', personShare: 0, personPaid: 10, balanceContribution: 10, expenseId: 'gift' }),
    ])
  })

  it('calculates descending personal category totals and ignores zero or settlement rows', () => {
    expect(memberCategoryTotals(expenses, 'me')).toEqual([
      { category: 'food', amount: 20 },
      { category: 'uncategorized', amount: 5 },
    ])
    expect(memberCategoryTotals(expenses, 'other-alex')).toEqual([])
  })

  it('uses stable ids as a readable fallback when activity members are missing', () => {
    const groupWithoutCurrency = { ...group, currency: undefined }
    const missingMembers = buildCsvExportRows(groupWithoutCurrency, [], [expenses[0], expenses[2]], { type: 'activity' })
    expect(missingMembers[0]).toMatchObject({ paidBy: 'me', person: 'me' })
    expect(missingMembers.at(-1)).toMatchObject({ settlementFrom: 'maya', settlementTo: 'me', currency: 'USD' })
  })

  it('serializes Excel-friendly UTF-8 CSV and safely escapes punctuation and newlines', () => {
    const csv = serializeCsv(buildCsvExportRows(group, members, expenses, { type: 'member', memberId: 'me' }))

    expect(csv.startsWith('\uFEFFrecord_type,recorded_at')).toBe(true)
    expect(csv).toContain('"Dinner, ""great""\nnight"')
    expect(csv).toContain('2026-08-20T23:30:00.000Z,2026-08-21T00:00:00.000Z')
    expect(csv.split('\r\n')[0].endsWith('expense_id')).toBe(true)
  })

  it('localizes headers and human-readable values for a Chinese interface', () => {
    const csv = serializeCsv(buildCsvExportRows(group, members, expenses, { type: 'activity' }), 'zh-CN')
    const [header] = csv.slice(1).split('\r\n')

    expect(header).toBe('记录类型,记录时间,最后编辑时间,分类,说明,支出总额,付款人,成员,成员应承担,成员已垫付,余额影响,还款净流入,还款人,收款人,币种,分摊方式,支出 ID')
    expect(csv).toContain('支出,2026-08-20T23:30:00.000Z,2026-08-21T00:00:00.000Z,餐饮')
    expect(csv).toContain(',CNY,指定金额,dinner')
    expect(csv).toContain('还款,2026-08-21T02:00:00.000Z,,,还款记录,')
    expect(csv).not.toContain('record_type')
  })

  it('creates safe filenames for all, personal, and punctuation-only activity names', () => {
    const date = new Date('2026-08-28T20:00:00.000Z')
    expect(csvExportFilename(group.name, 'Maya Chen', date)).toBe('tally-上海-trip-maya-chen-2026-08-28.csv')
    expect(csvExportFilename(group.name, null, date)).toBe('tally-上海-trip-all-2026-08-28.csv')
    expect(csvExportFilename(' !!! ', null, date)).toBe('tally-activity-all-2026-08-28.csv')
  })

  it('downloads a CSV blob and releases its object URL', () => {
    vi.useFakeTimers()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    downloadCsv('\uFEFFa,b', 'data.csv')

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download="data.csv"]')).not.toBeInTheDocument()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv')
    vi.useRealTimers()
  })
})
