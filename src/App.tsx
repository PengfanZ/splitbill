'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Bell,
  Check,
  ChevronRight,
  CircleDollarSign,
  LayoutDashboard,
  Menu,
  Plus,
  ReceiptText,
  Search,
  Settings,
  Share2,
  Sparkles,
  Trash2,
  Users,
  WalletCards,
  X,
} from 'lucide-react'

export type Member = { id: string; name: string; initials: string; color: string }
export type ActivityGroup = { id: string; name: string; emoji: string; memberIds: string[] }
export type SplitMethod = 'equal' | 'exact'
export type Expense = {
  id: string
  groupId: string
  title: string
  amount: number
  payerId: string
  splitMethod: SplitMethod
  shares: Record<string, number>
  createdAt: string
}
export type PersistedState = {
  groups: ActivityGroup[]
  friends: Member[]
  expenses: Expense[]
  selectedGroupId: string | null
}
export type Settlement = { from: Member; to: Member; amount: number }
export type ShareResult = 'shared' | 'copied' | 'downloaded' | 'cancelled' | 'failed'

export const STORAGE_KEY = 'tally:frontend:v2'
export const CURRENT_USER: Member = { id: 'me', name: 'You', initials: 'ME', color: '#ead1b9' }
const FRIEND_COLORS = ['#d6e8dc', '#f6d5bd', '#d8dde8', '#f3d9da', '#d7e6ee', '#f1dda9']
export const EMPTY_STATE: PersistedState = { groups: [], friends: [], expenses: [], selectedGroupId: null }

export const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
export const money = (value: number) => `$${Math.abs(value).toFixed(2)}`
export const initialsFor = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || '?'
export const SHARE_MESSAGES: Record<ShareResult, string> = {
  shared: 'PNG summary shared.',
  copied: 'Summary copied. Paste it into any chat.',
  downloaded: 'PNG summary downloaded.',
  cancelled: 'Sharing cancelled.',
  failed: 'Could not export the summary. Please try again.',
}

export function calculateSettlements(members: Member[], expenses: Expense[]): Settlement[] {
  const balances = members.map(member => {
    const paid = expenses.reduce((sum, expense) => sum + (expense.payerId === member.id ? expense.amount : 0), 0)
    const share = expenses.reduce((sum, expense) => sum + (expense.shares[member.id] ?? 0), 0)
    return { member, balance: paid - share }
  })
  const creditors = balances.filter(item => item.balance > 0.005).map(item => ({ member: item.member, cents: Math.round(item.balance * 100) }))
  const debtors = balances.filter(item => item.balance < -0.005).map(item => ({ member: item.member, cents: Math.round(Math.abs(item.balance) * 100) }))
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

export function buildShareSummary(group: ActivityGroup, members: Member[], expenses: Expense[]) {
  const memberMap = new Map(members.map(member => [member.id, member]))
  const total = expenses.reduce((sum, item) => sum + item.amount, 0)
  const expenseLines = expenses.length
    ? expenses.map(item => `• ${item.title} — ${money(item.amount)}, paid by ${memberMap.get(item.payerId)?.name ?? 'Unknown'} (${item.splitMethod === 'equal' ? 'split equally' : 'exact split'})`)
    : ['• No expenses yet.']
  const settlements = calculateSettlements(members, expenses)
  const settlementLines = settlements.length
    ? settlements.map(item => `• ${item.from.name} pays ${item.to.name} ${money(item.amount)}`)
    : ['• Everyone is settled.']

  return [
    `Tally summary — ${group.name}`,
    `Total spent: ${money(total)}`,
    '',
    'Expenses',
    ...expenseLines,
    '',
    'Suggested payments',
    ...settlementLines,
    '',
    'Shared from Tally',
  ].join('\n')
}

export async function createSummaryCard(group: ActivityGroup, members: Member[], expenses: Expense[]) {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1350
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')

  const total = expenses.reduce((sum, item) => sum + item.amount, 0)
  const settlements = calculateSettlements(members, expenses)
  const memberMap = new Map(members.map(member => [member.id, member]))
  const visibleExpenses = expenses.slice(0, 5)

  context.fillStyle = '#f7f4ee'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#e8584f'
  context.font = '700 40px Arial, sans-serif'
  context.fillText('Tally.', 72, 82)
  context.fillStyle = '#26231f'
  context.font = '400 70px Georgia, serif'
  context.fillText(group.name, 72, 178, 936)
  context.fillStyle = '#746e67'
  context.font = '500 24px Arial, sans-serif'
  context.fillText(`${members.length} ${members.length === 1 ? 'person' : 'people'} sharing expenses`, 74, 225)

  context.fillStyle = '#ffffff'
  context.fillRect(72, 278, 936, 190)
  context.fillStyle = '#746e67'
  context.font = '600 22px Arial, sans-serif'
  context.fillText('TOTAL SPENT', 112, 330)
  context.fillStyle = '#26231f'
  context.font = '400 74px Georgia, serif'
  context.fillText(money(total), 112, 420)

  context.fillStyle = '#26231f'
  context.font = '700 30px Arial, sans-serif'
  context.fillText('Suggested payments', 72, 540)
  context.fillStyle = '#d8d1c8'
  context.fillRect(72, 560, 936, 2)
  context.font = '600 27px Arial, sans-serif'
  if (settlements.length) {
    settlements.slice(0, 4).forEach((item, index) => {
      const y = 620 + index * 58
      context.fillStyle = '#26231f'
      context.fillText(`${item.from.name} pays ${item.to.name}`, 82, y, 710)
      context.fillStyle = '#e8584f'
      context.textAlign = 'right'
      context.fillText(money(item.amount), 998, y)
      context.textAlign = 'left'
    })
  } else {
    context.fillStyle = '#16724c'
    context.fillText('Everyone is settled', 82, 620)
  }

  const expenseHeadingY = 620 + Math.max(1, Math.min(4, settlements.length)) * 58 + 72
  context.fillStyle = '#26231f'
  context.font = '700 30px Arial, sans-serif'
  context.fillText('Expenses', 72, expenseHeadingY)
  context.fillStyle = '#d8d1c8'
  context.fillRect(72, expenseHeadingY + 20, 936, 2)
  context.font = '500 24px Arial, sans-serif'
  if (visibleExpenses.length) {
    visibleExpenses.forEach((item, index) => {
      const y = expenseHeadingY + 78 + index * 58
      context.fillStyle = '#26231f'
      context.fillText(item.title, 82, y, 460)
      context.fillStyle = '#746e67'
      const payer = memberMap.get(item.payerId)?.name ?? 'Unknown'
      context.fillText(`${payer} paid · ${item.splitMethod === 'equal' ? 'Equal split' : 'Exact split'}`, 390, y, 410)
      context.fillStyle = '#26231f'
      context.textAlign = 'right'
      context.fillText(money(item.amount), 998, y)
      context.textAlign = 'left'
    })
    if (expenses.length > visibleExpenses.length) {
      context.fillStyle = '#746e67'
      context.fillText(`+ ${expenses.length - visibleExpenses.length} more expenses`, 82, expenseHeadingY + 78 + visibleExpenses.length * 58)
    }
  } else {
    context.fillStyle = '#746e67'
    context.fillText('No expenses yet.', 82, expenseHeadingY + 78)
  }

  context.fillStyle = '#746e67'
  context.font = '500 21px Arial, sans-serif'
  context.fillText('Shared from Tally · Settle up simply', 72, 1290)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG generation failed')), 'image/png')
  })
}

export async function shareActivitySummary(title: string, text: string, image: Blob | null): Promise<ShareResult> {
  const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tally-summary'}.png`
  if (image) {
    const file = new File([image], filename, { type: 'image/png' })
    const shareData = { title, text, files: [file] }
    if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData)
        return 'shared'
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      }
    }

    try {
      const url = URL.createObjectURL(image)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      return 'downloaded'
    } catch {
      // Continue to the text fallback.
    }
  }

  if (!image && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return 'copied'
    } catch {
      return 'failed'
    }
  }

  return 'failed'
}

export async function exportActivitySummary(group: ActivityGroup, members: Member[], expenses: Expense[]) {
  const title = `${group.name} — Tally`
  const text = buildShareSummary(group, members, expenses)
  try {
    const image = await createSummaryCard(group, members, expenses)
    return shareActivitySummary(title, text, image)
  } catch {
    return shareActivitySummary(title, text, null)
  }
}

export function parseState(stored: string | null): PersistedState {
  try {
    if (!stored) return EMPTY_STATE
    const parsed = JSON.parse(stored) as Partial<PersistedState>
    if (!Array.isArray(parsed.groups) || !Array.isArray(parsed.friends) || !Array.isArray(parsed.expenses)) return EMPTY_STATE
    return {
      groups: parsed.groups,
      friends: parsed.friends,
      expenses: parsed.expenses,
      selectedGroupId: typeof parsed.selectedGroupId === 'string' ? parsed.selectedGroupId : parsed.groups[0]?.id ?? null,
    }
  } catch {
    return EMPTY_STATE
  }
}

export function loadState(): PersistedState {
  try {
    return parseState(localStorage.getItem(STORAGE_KEY))
  } catch {
    return EMPTY_STATE
  }
}

export function saveState(state: PersistedState) {
  try {
    const serialized = JSON.stringify(state)
    if (localStorage.getItem(STORAGE_KEY) !== serialized) localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // Keep the app usable when local storage is unavailable.
  }
}

export function Avatar({ member, size = 'md' }: { member: Member; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar--${size}`} style={{ background: member.color }}>{member.initials}</span>
}

export function Sidebar({ groups, selectedId, onSelect, onCreate, onReset }: {
  groups: ActivityGroup[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onReset: () => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const items = [[LayoutDashboard, 'Overview'], [Activity, 'Activity'], [Users, 'Groups'], [WalletCards, 'Friends']] as const

  return (
    <>
      <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu /></button>
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">Tally<span>.</span></div>
          <button className="sidebar-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X /></button>
        </div>
        <nav aria-label="Primary navigation">
          {items.map(([Icon, label], index) => (
            <button key={label} className={`nav-item ${index === 0 ? 'is-active' : ''}`} onClick={() => setMobileOpen(false)}>
              <Icon size={19} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="add-button" onClick={() => { onCreate(); setMobileOpen(false) }}><Plus size={20} />New activity</button>
        <div className="group-section">
          <p className="section-label">Your activities</p>
          {groups.length ? groups.map(group => (
            <button key={group.id} className={`group-row group-row--button ${group.id === selectedId ? 'is-selected' : ''}`} onClick={() => { onSelect(group.id); setMobileOpen(false) }}>
              <span className="group-icon green">{group.emoji}</span>
              <span><b>{group.name}</b><small>{group.memberIds.length} {group.memberIds.length === 1 ? 'person' : 'people'}</small></span>
              <ChevronRight size={15} />
            </button>
          )) : <p className="sidebar-empty">No activities yet.</p>}
        </div>
        {groups.length ? <button className="reset-button" onClick={onReset}>Reset local data</button> : null}
      </aside>
      {mobileOpen ? <button className="backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} /> : null}
    </>
  )
}

export function Topbar({ query, setQuery }: { query: string; setQuery: (value: string) => void }) {
  return (
    <header className="topbar">
      <div className="search-box"><Search size={18} /><input aria-label="Search expenses" placeholder="Search this activity…" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button> : null}</div>
      <button className="icon-button" aria-label="Notifications"><Bell size={20} /><i /></button>
      <button className="icon-button" aria-label="Settings"><Settings size={20} /></button>
    </header>
  )
}

export function FreshStart({ onCreate }: { onCreate: () => void }) {
  return (
    <main className="fresh-start">
      <div className="fresh-illustration"><span><Users size={32} /></span><i /><i /><i /></div>
      <p className="fresh-kicker">A clean slate</p>
      <h1>Start your first activity</h1>
      <p>Create a group for a trip, home, dinner, or anything you share. Add friends now or invite them later.</p>
      <button className="confirm-button fresh-button" onClick={onCreate}><Plus size={18} />Create an activity</button>
      <div className="fresh-steps"><span><b>1</b>Name the activity</span><span><b>2</b>Add your friends</span><span><b>3</b>Split expenses fairly</span></div>
    </main>
  )
}

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

export function ExpenseList({ expenses, members, query, onDeleteExpense }: { expenses: Expense[]; members: Member[]; query: string; onDeleteExpense: (expense: Expense) => void }) {
  const memberMap = useMemo(() => new Map(members.map(member => [member.id, member])), [members])
  const visible = expenses.filter(expense => expense.title.toLowerCase().includes(query.toLowerCase()))
  return (
    <section className="content-section activity-section">
      <div className="section-heading"><h2>Expenses</h2><span className="section-meta">{visible.length} {visible.length === 1 ? 'entry' : 'entries'}</span></div>
      <div className="activity-list">
        {visible.length ? visible.map(expense => {
          const payer = memberMap.get(expense.payerId) ?? CURRENT_USER
          return (
            <div className="activity-row" key={expense.id}>
              <span className="expense-icon"><ReceiptText size={18} /></span>
              <span className="row-copy"><b>{expense.title}</b><small>{payer.name} paid<i />Split {expense.splitMethod === 'equal' ? 'equally' : 'by exact amounts'}</small></span>
              <span className="expense-amount"><b>{money(expense.amount)}</b><small>{expense.createdAt}</small></span>
              <button className="expense-delete" type="button" aria-label={`Delete ${expense.title}`} title="Delete expense" onClick={() => onDeleteExpense(expense)}><Trash2 size={16} /></button>
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

export function GroupDashboard({ group, members, expenses, query, shareFeedback, onShare, onAddFriend, onAddExpense, onDeleteExpense }: {
  group: ActivityGroup
  members: Member[]
  expenses: Expense[]
  query: string
  shareFeedback: string | null
  onShare: () => void
  onAddFriend: () => void
  onAddExpense: () => void
  onDeleteExpense: (expense: Expense) => void
}) {
  return (
    <main className="dashboard">
      <div className="main-column">
        <header className="group-welcome">
          <div><span className="date">{group.emoji} Activity group</span><h1>{group.name}</h1><p>{members.length} people sharing expenses together.</p></div>
          <div className="group-share"><div className="group-actions"><button className="outline-button" onClick={onShare}><Share2 size={16} />Share summary</button><button className="outline-button" onClick={onAddFriend}><Users size={16} />Add friend</button><button className="confirm-button" onClick={onAddExpense}><Plus size={17} />Add expense</button></div>{shareFeedback ? <span className="share-feedback" role="status">{shareFeedback}</span> : null}</div>
        </header>
        <ActivitySummary expenses={expenses} />
        <SettlementDirections members={members} expenses={expenses} />
        <ExpenseList expenses={expenses} members={members} query={query} onDeleteExpense={onDeleteExpense} />
      </div>
      <MembersRail members={members} expenses={expenses} onAddFriend={onAddFriend} />
    </main>
  )
}

export function ModalShell({ eyebrow, title, onClose, children }: { eyebrow: string; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header"><div><span>{eyebrow}</span><h2 id="modal-title">{title}</h2></div><button aria-label="Close" onClick={onClose}><X size={20} /></button></div>
        {children}
      </section>
    </div>
  )
}

export function CreateGroupModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, friendNames: string[]) => void }) {
  const [name, setName] = useState('')
  const [friends, setFriends] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSave(name.trim(), friends.split(',').map(friend => friend.trim()).filter(Boolean))
  }
  return (
    <ModalShell eyebrow="New activity" title="What are you sharing?" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Activity name<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Beach weekend" required /></label>
        <label>Add friends <small>Separate names with commas. You can add more later.</small><textarea value={friends} onChange={event => setFriends(event.target.value)} placeholder="Maya Chen, Jordan Lee" rows={3} /></label>
        <div className="split-note"><Users size={18} /><span>You’ll be included in the activity automatically.</span></div>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="confirm-button" type="submit">Create activity</button></div>
      </form>
    </ModalShell>
  )
}

export function AddFriendModal({ onClose, onSave }: { onClose: () => void; onSave: (names: string[]) => void }) {
  const [names, setNames] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = names.split(',').map(name => name.trim()).filter(Boolean)
    if (!parsed.length) return
    onSave(parsed)
  }
  return (
    <ModalShell eyebrow="Add people" title="Who’s joining?" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Friend names <small>Separate multiple names with commas.</small><textarea autoFocus value={names} onChange={event => setNames(event.target.value)} placeholder="Sam Rivera, Taylor Kim" rows={3} required /></label>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="confirm-button" type="submit">Add friends</button></div>
      </form>
    </ModalShell>
  )
}

export function ExpenseModal({ group, members, onClose, onSave }: { group: ActivityGroup; members: Member[]; onClose: () => void; onSave: (expense: Expense) => void }) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [payerId, setPayerId] = useState('me')
  const [method, setMethod] = useState<SplitMethod>('equal')
  const [exactShares, setExactShares] = useState<Record<string, string>>({})
  const numericAmount = Number(amount) || 0
  const exactTotal = members.reduce((sum, member) => sum + (Number(exactShares[member.id]) || 0), 0)
  const remaining = numericAmount - exactTotal
  const exactValid = Math.abs(remaining) < 0.005

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || numericAmount <= 0 || (method === 'exact' && !exactValid)) return
    let shares: Record<string, number>
    if (method === 'equal') {
      const totalCents = Math.round(numericAmount * 100)
      const base = Math.floor(totalCents / members.length)
      let extra = totalCents - base * members.length
      shares = Object.fromEntries(members.map(member => {
        const cents = base + (extra > 0 ? 1 : 0)
        extra = Math.max(0, extra - 1)
        return [member.id, cents / 100]
      }))
    } else {
      shares = Object.fromEntries(members.map(member => [member.id, Number(exactShares[member.id]) || 0]))
    }
    onSave({ id: makeId('expense'), groupId: group.id, title: title.trim(), amount: numericAmount, payerId, splitMethod: method, shares, createdAt: 'Just now' })
  }

  return (
    <ModalShell eyebrow={group.name} title="Add a shared expense" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Description<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Groceries" required /></label>
        <label>Amount<span className="modal-amount"><i>$</i><input aria-label="Amount" value={amount} onChange={event => setAmount(event.target.value)} type="number" min="0.01" step="0.01" placeholder="0.00" required /></span></label>
        <div className="form-grid">
          <label>Paid by<select value={payerId} onChange={event => setPayerId(event.target.value)}>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
          <label>Split method<select value={method} onChange={event => setMethod(event.target.value as SplitMethod)}><option value="equal">Equally</option><option value="exact">Exact amounts</option></select></label>
        </div>
        {method === 'equal' ? (
          <div className="split-preview"><span><Users size={18} />Each person’s share</span><strong>{members.length ? money(numericAmount / members.length) : '$0.00'}</strong></div>
        ) : (
          <div className="exact-splits">
            <div className="exact-heading"><span>Enter each share</span><b className={exactValid ? 'positive' : remaining < 0 ? 'negative' : ''}>{remaining >= 0 ? `${money(remaining)} left` : `${money(remaining)} over`}</b></div>
            {members.map(member => <label className="share-row" key={member.id}><span><Avatar member={member} size="sm" />{member.name}</span><span className="share-input"><i>$</i><input aria-label={`${member.name} share`} type="number" min="0" step="0.01" value={exactShares[member.id] ?? ''} onChange={event => setExactShares(current => ({ ...current, [member.id]: event.target.value }))} placeholder="0.00" /></span></label>)}
          </div>
        )}
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="confirm-button" type="submit" disabled={method === 'exact' && !exactValid}>Save expense</button></div>
      </form>
    </ModalShell>
  )
}

export default function App() {
  const [state, setState] = useState<PersistedState>(() => loadState())
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<'group' | 'friend' | 'expense' | null>(null)
  const [shareFeedback, setShareFeedback] = useState<{ groupId: string; message: string } | null>(null)

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setState(parseState(event.newValue))
    }
    window.addEventListener('storage', syncAcrossTabs)
    return () => window.removeEventListener('storage', syncAcrossTabs)
  }, [])

  const selectedGroup = state.groups.find(group => group.id === state.selectedGroupId) ?? state.groups[0] ?? null
  const selectedMembers = selectedGroup
    ? [CURRENT_USER, ...state.friends.filter(friend => selectedGroup.memberIds.includes(friend.id))]
    : [CURRENT_USER]
  const selectedExpenses = selectedGroup ? state.expenses.filter(expense => expense.groupId === selectedGroup.id) : []

  const createGroup = (name: string, friendNames: string[]) => {
    const newFriends = friendNames.map((friendName, index) => ({ id: makeId('friend'), name: friendName, initials: initialsFor(friendName), color: FRIEND_COLORS[(state.friends.length + index) % FRIEND_COLORS.length] }))
    const group: ActivityGroup = { id: makeId('group'), name, emoji: ['✦', '⌂', '☀', '✈'][state.groups.length % 4], memberIds: ['me', ...newFriends.map(friend => friend.id)] }
    setState(current => ({ ...current, groups: [...current.groups, group], friends: [...current.friends, ...newFriends], selectedGroupId: group.id }))
    setModal(null)
  }

  const addFriends = (names: string[]) => {
    if (!selectedGroup) return
    const newFriends = names.map((name, index) => ({ id: makeId('friend'), name, initials: initialsFor(name), color: FRIEND_COLORS[(state.friends.length + index) % FRIEND_COLORS.length] }))
    setState(current => ({
      ...current,
      friends: [...current.friends, ...newFriends],
      groups: current.groups.map(group => group.id === selectedGroup.id ? { ...group, memberIds: [...group.memberIds, ...newFriends.map(friend => friend.id)] } : group),
    }))
    setModal(null)
  }

  const addExpense = (expense: Expense) => {
    setState(current => ({ ...current, expenses: [expense, ...current.expenses] }))
    setModal(null)
  }

  const shareGroup = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const result = await exportActivitySummary(group, members, expenses)
    setShareFeedback({ groupId: group.id, message: SHARE_MESSAGES[result] })
  }

  const deleteExpense = (expense: Expense) => {
    if (!window.confirm(`Delete "${expense.title}"? This removes it from the activity and recalculates everyone’s balances.`)) return
    setState(current => ({ ...current, expenses: current.expenses.filter(item => item.id !== expense.id) }))
  }

  const resetData = () => {
    if (!window.confirm('Reset every local activity, friend, and expense? This cannot be undone.')) return
    setState(EMPTY_STATE)
    setQuery('')
  }

  return (
    <div className="app-shell">
      <Sidebar groups={state.groups} selectedId={selectedGroup?.id ?? null} onSelect={id => setState(current => ({ ...current, selectedGroupId: id }))} onCreate={() => setModal('group')} onReset={resetData} />
      <div className="workspace">
        <Topbar query={query} setQuery={setQuery} />
        {selectedGroup ? <GroupDashboard group={selectedGroup} members={selectedMembers} expenses={selectedExpenses} query={query} shareFeedback={shareFeedback?.groupId === selectedGroup.id ? shareFeedback.message : null} onShare={() => shareGroup(selectedGroup, selectedMembers, selectedExpenses)} onAddFriend={() => setModal('friend')} onAddExpense={() => setModal('expense')} onDeleteExpense={deleteExpense} /> : <FreshStart onCreate={() => setModal('group')} />}
      </div>
      {modal === 'group' ? <CreateGroupModal onClose={() => setModal(null)} onSave={createGroup} /> : null}
      {modal === 'friend' ? <AddFriendModal onClose={() => setModal(null)} onSave={addFriends} /> : null}
      {modal === 'expense' && selectedGroup ? <ExpenseModal group={selectedGroup} members={selectedMembers} onClose={() => setModal(null)} onSave={addExpense} /> : null}
    </div>
  )
}
