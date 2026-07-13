import type { Expense, Member, Settlement } from './models'

export const money = (value: number) => `$${Math.abs(value).toFixed(2)}`

export function calculateSettlements(members: Member[], expenses: Expense[]): Settlement[] {
  const balances = members.map(member => {
    const paid = expenses.reduce((sum, expense) => sum + (expense.payerId === member.id ? expense.amount : 0), 0)
    const share = expenses.reduce((sum, expense) => sum + (expense.shares[member.id] ?? 0), 0)
    return { member, balance: paid - share }
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
