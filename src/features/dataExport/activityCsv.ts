import type { CurrencyCode } from '../../domain/currency'
import { expenseCategory, type ExpenseCategory } from '../../domain/expenseCategories'
import { getSettlementRecipientId, isSettlementPayment, spendingExpenses } from '../../domain/expenses'
import type { ActivityGroup, Expense, Member } from '../../domain/models'

export type CsvExportScope =
  | { type: 'activity' }
  | { type: 'member'; memberId: string }

export type CsvExportRow = {
  recordType: 'expense' | 'settlement'
  recordedAt: string
  lastEditedAt: string
  category: ExpenseCategory | ''
  description: string
  expenseTotal: number | ''
  paidBy: string
  person: string
  personShare: number | ''
  personPaid: number | ''
  balanceContribution: number | ''
  settlementFlow: number | ''
  settlementFrom: string
  settlementTo: string
  currency: CurrencyCode
  splitMethod: Expense['splitMethod'] | ''
  expenseId: string
}

export type CsvExportPreview = {
  rowCount: number
  expenseCount: number
  settlementCount: number
  personalShare: number
  personalPaid: number
  settlementFlow: number
}

const CSV_COLUMNS: ReadonlyArray<[keyof CsvExportRow, string]> = [
  ['recordType', 'record_type'],
  ['recordedAt', 'recorded_at'],
  ['lastEditedAt', 'last_edited_at'],
  ['category', 'category'],
  ['description', 'description'],
  ['expenseTotal', 'expense_total'],
  ['paidBy', 'paid_by'],
  ['person', 'person'],
  ['personShare', 'person_share'],
  ['personPaid', 'person_paid'],
  ['balanceContribution', 'balance_contribution'],
  ['settlementFlow', 'settlement_flow'],
  ['settlementFrom', 'settlement_from'],
  ['settlementTo', 'settlement_to'],
  ['currency', 'currency'],
  ['splitMethod', 'split_method'],
  ['expenseId', 'expense_id'],
]

function memberName(memberMap: Map<string, Member>, memberId: string) {
  return memberMap.get(memberId)?.name ?? memberId
}

function expenseRows(
  expense: Expense,
  memberMap: Map<string, Member>,
  currency: CurrencyCode,
  memberId?: string,
): CsvExportRow[] {
  const payerName = memberName(memberMap, expense.payerId)
  const participantShares = Object.entries(expense.shares).filter(([, share]) => share > 0)
  if (!participantShares.some(([participantId]) => participantId === expense.payerId)) {
    participantShares.push([expense.payerId, 0])
  }
  return participantShares
    .filter(([participantId]) => !memberId || participantId === memberId)
    .map(([memberId, share]) => {
      const paid = memberId === expense.payerId ? expense.amount : 0
      return {
        recordType: 'expense',
        recordedAt: expense.createdAt,
        lastEditedAt: expense.updatedAt ?? '',
        category: expenseCategory(expense),
        description: expense.title,
        expenseTotal: expense.amount,
        paidBy: payerName,
        person: memberName(memberMap, memberId),
        personShare: share,
        personPaid: paid,
        balanceContribution: paid - share,
        settlementFlow: '',
        settlementFrom: '',
        settlementTo: '',
        currency,
        splitMethod: expense.splitMethod,
        expenseId: expense.id,
      }
    })
}

function settlementRows(
  expense: Expense,
  memberMap: Map<string, Member>,
  currency: CurrencyCode,
  memberId?: string,
): CsvExportRow[] {
  const recipientId = getSettlementRecipientId(expense)
  if (!recipientId) return []
  const from = memberName(memberMap, expense.payerId)
  const to = memberName(memberMap, recipientId)
  return [
    { memberId: expense.payerId, person: from, flow: -expense.amount },
    { memberId: recipientId, person: to, flow: expense.amount },
  ].filter(participant => !memberId || participant.memberId === memberId).map(({ person, flow }) => ({
    recordType: 'settlement',
    recordedAt: expense.createdAt,
    lastEditedAt: expense.updatedAt ?? '',
    category: '',
    description: expense.title,
    expenseTotal: '',
    paidBy: from,
    person,
    personShare: '',
    personPaid: '',
    balanceContribution: '',
    settlementFlow: flow,
    settlementFrom: from,
    settlementTo: to,
    currency,
    splitMethod: '',
    expenseId: expense.id,
  }))
}

export function buildCsvExportRows(
  group: ActivityGroup,
  members: Member[],
  expenses: Expense[],
  scope: CsvExportScope,
): CsvExportRow[] {
  const memberMap = new Map(members.map(member => [member.id, member]))
  const selectedMemberId = scope.type === 'member' ? scope.memberId : undefined
  const rows = expenses.flatMap(expense => isSettlementPayment(expense)
    ? settlementRows(expense, memberMap, group.currency ?? 'USD', selectedMemberId)
    : expenseRows(expense, memberMap, group.currency ?? 'USD', selectedMemberId))
  return rows
}

export function csvExportPreview(
  rows: CsvExportRow[],
): CsvExportPreview {
  return {
    rowCount: rows.length,
    expenseCount: new Set(rows.filter(row => row.recordType === 'expense').map(row => row.expenseId)).size,
    settlementCount: new Set(rows.filter(row => row.recordType === 'settlement').map(row => row.expenseId)).size,
    personalShare: rows.reduce((sum, row) => sum + (typeof row.personShare === 'number' ? row.personShare : 0), 0),
    personalPaid: rows.reduce((sum, row) => sum + (typeof row.personPaid === 'number' ? row.personPaid : 0), 0),
    settlementFlow: rows.reduce((sum, row) => sum + (typeof row.settlementFlow === 'number' ? row.settlementFlow : 0), 0),
  }
}

export function memberCategoryTotals(expenses: Expense[], memberId: string) {
  const totals = new Map<ExpenseCategory, number>()
  spendingExpenses(expenses).forEach(expense => {
    const share = expense.shares[memberId] ?? 0
    if (share <= 0) return
    const category = expenseCategory(expense)
    totals.set(category, (totals.get(category) ?? 0) + share)
  })
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount)
}

function csvValue(value: CsvExportRow[keyof CsvExportRow]) {
  if (typeof value === 'number') return value.toFixed(2)
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function serializeCsv(rows: CsvExportRow[]) {
  const header = CSV_COLUMNS.map(([, label]) => label).join(',')
  const body = rows.map(row => CSV_COLUMNS.map(([key]) => csvValue(row[key])).join(','))
  return `\uFEFF${[header, ...body].join('\r\n')}`
}

function filenamePart(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '') || 'activity'
}

export function csvExportFilename(groupName: string, memberNameValue: string | null, date = new Date()) {
  const scope = memberNameValue ? `-${filenamePart(memberNameValue)}` : '-all'
  return `tally-${filenamePart(groupName)}${scope}-${date.toISOString().slice(0, 10)}.csv`
}

export function downloadCsv(csv: string, filename: string, documentTarget: Document = document) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = documentTarget.createElement('a')
  anchor.href = url
  anchor.download = filename
  documentTarget.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
