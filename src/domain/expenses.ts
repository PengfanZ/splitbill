import type { Expense, Member, Settlement } from './models'

export const money = (value: number) => `$${Math.abs(value).toFixed(2)}`
export const isSettlementPayment = (expense: Expense) => expense.kind === 'settlement'
export const spendingExpenses = (expenses: Expense[]) => expenses.filter(expense => !isSettlementPayment(expense))
export const createExpenseTimestamp = (date = new Date()) => date.toISOString()

const expenseDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatExpenseTimestamp(expense: Expense, formatter = expenseDateTimeFormatter) {
  const storedTimestamp = expense.updatedAt ?? expense.createdAt
  const date = new Date(storedTimestamp)
  if (Number.isNaN(date.getTime())) return storedTimestamp === 'Just now' ? 'Time not recorded' : storedTimestamp
  return `${expense.updatedAt ? 'Edited' : 'Created'} ${formatter.format(date)}`
}

export function calculateMemberBalance(memberId: string, expenses: Expense[]) {
  return expenses.reduce((balance, expense) => (
    balance
    + (expense.payerId === memberId ? expense.amount : 0)
    - (expense.shares[memberId] ?? 0)
  ), 0)
}

export function getSettlementRecipientId(expense: Expense) {
  if (!isSettlementPayment(expense)) return null
  return Object.keys(expense.shares).find(memberId => memberId !== expense.payerId) ?? null
}

export function createSettlementPayment(groupId: string, settlement: Settlement, amount: number, id: string, createdAt = createExpenseTimestamp()): Expense {
  const amountCents = Math.round(amount * 100)
  const suggestedCents = Math.round(settlement.amount * 100)
  if (amountCents <= 0 || amountCents > suggestedCents) throw new RangeError('Settlement amount must be within the suggested payment')
  const roundedAmount = amountCents / 100
  return {
    id,
    groupId,
    title: 'Settlement payment',
    amount: roundedAmount,
    payerId: settlement.from.id,
    splitMethod: 'exact',
    shares: { [settlement.to.id]: roundedAmount },
    createdAt,
    kind: 'settlement',
  }
}

export function calculateSettlements(members: Member[], expenses: Expense[]): Settlement[] {
  const balances = members.map(member => {
    return { member, balance: calculateMemberBalance(member.id, expenses) }
  })
  const creditors = balances
    .filter(item => item.balance > 0.005)
    .map(item => ({ member: item.member, cents: Math.round(item.balance * 100) }))
  const debtors = balances
    .filter(item => item.balance < -0.005)
    .map(item => ({ member: item.member, cents: Math.round(Math.abs(item.balance) * 100) }))
  const settlements: Settlement[] = []
  let creditorIndex = 0
  let debtorIndex = 0

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex]
    const debtor = debtors[debtorIndex]
    const cents = Math.min(creditor.cents, debtor.cents)
    settlements.push({ from: debtor.member, to: creditor.member, amount: cents / 100 })
    creditor.cents -= cents
    debtor.cents -= cents
    if (creditor.cents === 0) creditorIndex += 1
    if (debtor.cents === 0) debtorIndex += 1
  }

  return settlements
}

export function createEqualShares(members: Member[], amount: number) {
  const totalCents = Math.round(amount * 100)
  const base = Math.floor(totalCents / members.length)
  let extra = totalCents - base * members.length

  return Object.fromEntries(members.map(member => {
    const cents = base + (extra > 0 ? 1 : 0)
    extra = Math.max(0, extra - 1)
    return [member.id, cents / 100]
  }))
}

export function createExactShares(members: Member[], values: Record<string, string>) {
  return Object.fromEntries(members.map(member => [member.id, Number(values[member.id]) || 0]))
}
