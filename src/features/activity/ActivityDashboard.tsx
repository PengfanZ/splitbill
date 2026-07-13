import { useMemo } from 'react'
import {
  Check,
  CircleDollarSign,
  Pencil,
  Plus,
  ReceiptText,
  Share2,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { calculateSettlements, money } from '../../domain/expenses'
import { CURRENT_USER } from '../../domain/members'
import type { ActivityGroup, Expense, Member } from '../../domain/models'

export function ActivitySummary({ expenses }: { expenses: Expense[] }) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const paid = expenses.reduce((sum, expense) => sum + (expense.payerId === 'me' ? expense.amount : 0), 0)
  const share = expenses.reduce((sum, expense) => sum + (expense.shares.me ?? 0), 0)
  const balance = paid - share

  return (
    <div className="summary" aria-label="Activity summary">
      <div><span>Total spent</span><strong>{money(total)}</strong></div>
      <div><span>You paid</span><strong>{money(paid)}</strong></div>
      <div><span>Your balance</span><strong className={balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'settled'}>{balance > 0 ? '+' : balance < 0 ? '−' : ''}{money(balance)}</strong></div>
    </div>
  )
}

export function SettlementDirections({ members, expenses }: { members: Member[]; expenses: Expense[] }) {
  const settlements = calculateSettlements(members, expenses)

  return (
    <section className="content-section">
      <div className="section-heading"><h2>Who owes whom</h2><span className="section-meta">Suggested settlements</span></div>
      <div className="balance-list">
        {settlements.length ? settlements.map(settlement => (
          <div className="balance-row settlement-row" key={`${settlement.from.id}-${settlement.to.id}`}>
            <span className="settlement-avatars"><Avatar member={settlement.from} /><i>→</i><Avatar member={settlement.to} /></span>
            <span className="row-copy"><b>{settlement.from.id === 'me' ? `You owe ${settlement.to.name}` : `${settlement.from.name} owes ${settlement.to.name}`}</b><small>Suggested payment</small></span>
            <strong>{money(settlement.amount)}</strong>
          </div>
        )) : <div className="all-settled"><span><Check size={18} /></span><div><b>Everyone is settled</b><p>Add an expense to calculate who should pay whom.</p></div></div>}
      </div>
    </section>
  )
}

export function ExpenseList({ expenses, members, query, onEditExpense, onDeleteExpense }: {
  expenses: Expense[]
  members: Member[]
  query: string
  onEditExpense: (expense: Expense) => void
  onDeleteExpense: (expense: Expense) => void
}) {
  const memberMap = useMemo(() => new Map(members.map(member => [member.id, member])), [members])
  const visible = expenses.filter(expense => expense.title.toLowerCase().includes(query.toLowerCase()))

  return (
    <section className="content-section activity-section">
      <div className="section-heading"><h2>Expenses</h2><span className="section-meta">{visible.length} {visible.length === 1 ? 'entry' : 'entries'}</span></div>
      <div className="activity-list">
        {visible.length ? visible.map(expense => {
          const payer = memberMap.get(expense.payerId) ?? CURRENT_USER
          const participantCount = Object.keys(expense.shares).length
          return (
            <div className="activity-row" key={expense.id}>
              <span className="expense-icon"><ReceiptText size={18} /></span>
              <span className="row-copy"><b>{expense.title}</b><small>{payer.name} paid<i />{expense.splitMethod === 'equal' ? 'Split equally' : 'Exact split'} · {participantCount} {participantCount === 1 ? 'person' : 'people'}</small></span>
              <span className="expense-amount"><b>{money(expense.amount)}</b><small>{expense.createdAt}</small></span>
              <span className="expense-actions">
                <button className="expense-edit" type="button" aria-label={`Edit ${expense.title}`} title="Edit expense" onClick={() => onEditExpense(expense)}><Pencil size={15} /></button>
                <button className="expense-delete" type="button" aria-label={`Delete ${expense.title}`} title="Delete expense" onClick={() => onDeleteExpense(expense)}><Trash2 size={16} /></button>
              </span>
            </div>
          )
        }) : <div className="empty-state"><Sparkles size={22} /><p>{query ? 'No expenses match your search.' : 'No expenses yet. Add the first one when you’re ready.'}</p></div>}
      </div>
    </section>
  )
}

export function MembersRail({ members, expenses, onAddFriend }: { members: Member[]; expenses: Expense[]; onAddFriend: () => void }) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)

  return (
    <aside className="right-rail activity-rail">
      <section className="members-panel">
        <div className="rail-heading"><h2>People</h2><span>{members.length}</span></div>
        <div className="member-list">{members.map(member => <div className="member-row" key={member.id}><Avatar member={member} size="sm" /><span><b>{member.name}</b><small>{member.id === 'me' ? 'You' : 'Friend'}</small></span>{member.id === 'me' ? <Check size={15} /> : null}</div>)}</div>
        <button className="outline-button add-friend-button" onClick={onAddFriend}><Plus size={16} />Add friend</button>
      </section>
      <section className="rail-guide">
        <span className="guide-icon"><CircleDollarSign size={22} /></span>
        <h3>How splitting works</h3>
        <p>Choose who paid, then split equally or enter each person’s exact share. Tally updates everyone’s balance automatically.</p>
        <div><span>Activity total</span><strong>{money(total)}</strong></div>
      </section>
    </aside>
  )
}

export function GroupDashboard({ group, members, expenses, query, activityFeedback, onShare, onAddFriend, onAddExpense, onEditExpense, onDeleteExpense }: {
  group: ActivityGroup
  members: Member[]
  expenses: Expense[]
  query: string
  activityFeedback: string | null
  onShare: () => void
  onAddFriend: () => void
  onAddExpense: () => void
  onEditExpense: (expense: Expense) => void
  onDeleteExpense: (expense: Expense) => void
}) {
  return (
    <main className="dashboard">
      <div className="main-column">
        <header className="group-welcome">
          <div><span className="date">{group.emoji} Activity group</span><h1>{group.name}</h1><p>{members.length} people sharing expenses together.</p></div>
          <div className="group-share"><div className="group-actions"><button className="outline-button" onClick={onShare}><Share2 size={16} />Share summary</button><button className="outline-button" onClick={onAddFriend}><Users size={16} />Add friend</button><button className="confirm-button" onClick={onAddExpense}><Plus size={17} />Add expense</button></div>{activityFeedback ? <span className="activity-feedback" role="status">{activityFeedback}</span> : null}</div>
        </header>
        <ActivitySummary expenses={expenses} />
        <SettlementDirections members={members} expenses={expenses} />
        <ExpenseList expenses={expenses} members={members} query={query} onEditExpense={onEditExpense} onDeleteExpense={onDeleteExpense} />
      </div>
      <MembersRail members={members} expenses={expenses} onAddFriend={onAddFriend} />
    </main>
  )
}
