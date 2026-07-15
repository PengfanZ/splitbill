import { useState, type FormEvent } from 'react'
import { ArrowRight, CircleDollarSign, Pencil, Users } from 'lucide-react'
import { Avatar, ModalShell } from '../../components/AppShell'
import { createEqualShares, createExactShares, createExpenseTimestamp, createSettlementPayment, money } from '../../domain/expenses'
import { makeId } from '../../domain/members'
import type { ActivityGroup, Expense, Member, Settlement, SplitMethod } from '../../domain/models'

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

export function AddFriendModal({ existingExpenseCount, onClose, onSave }: { existingExpenseCount: number; onClose: () => void; onSave: (names: string[]) => void }) {
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
        {existingExpenseCount ? <div className="split-note future-note"><Users size={18} /><span><b>Future expenses only</b><small>{existingExpenseCount} existing {existingExpenseCount === 1 ? 'expense will' : 'expenses will'} stay unchanged.</small></span></div> : null}
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="confirm-button" type="submit">Add friends</button></div>
      </form>
    </ModalShell>
  )
}

export function SettleUpModal({ group, settlement, onClose, onSave }: {
  group: ActivityGroup
  settlement: Settlement
  onClose: () => void
  onSave: (payment: Expense, settlement: Settlement) => void
}) {
  const [amount, setAmount] = useState(settlement.amount.toFixed(2))
  const numericAmount = Number(amount) || 0
  const amountCents = Math.round(numericAmount * 100)
  const suggestedCents = Math.round(settlement.amount * 100)
  const valid = amountCents > 0 && amountCents <= suggestedCents

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    onSave(createSettlementPayment(group.id, settlement, numericAmount, makeId('settlement')), settlement)
  }

  return (
    <ModalShell eyebrow={group.name} title="Record a settlement" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="settlement-parties" aria-label={`${settlement.from.name} pays ${settlement.to.name}`}>
          <span><Avatar member={settlement.from} /><b>{settlement.from.name}</b><small>Pays</small></span>
          <ArrowRight size={20} />
          <span><Avatar member={settlement.to} /><b>{settlement.to.name}</b><small>Receives</small></span>
        </div>
        <label>Payment amount <small>Suggested amount: {money(settlement.amount)}</small><span className="modal-amount"><i>$</i><input autoFocus aria-label="Payment amount" value={amount} onChange={event => setAmount(event.target.value)} type="number" min="0.01" max={settlement.amount.toFixed(2)} step="0.01" required /></span></label>
        {valid ? null : <small className="split-error" role="alert">Enter an amount between $0.01 and {money(settlement.amount)}.</small>}
        <div className="split-note settlement-note"><CircleDollarSign size={18} /><span>This records a full or partial payment and recalculates the remaining balances. It does not increase the activity’s spending total.</span></div>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="confirm-button" type="submit" disabled={!valid}>Record payment</button></div>
      </form>
    </ModalShell>
  )
}

export function ExpenseModal({ group, members, expense, onClose, onSave }: {
  group: ActivityGroup
  members: Member[]
  expense?: Expense
  onClose: () => void
  onSave: (expense: Expense) => void
}) {
  const [title, setTitle] = useState(expense?.title ?? '')
  const [amount, setAmount] = useState(expense ? expense.amount.toString() : '')
  const [payerId, setPayerId] = useState(expense?.payerId ?? 'me')
  const [method, setMethod] = useState<SplitMethod>(expense?.splitMethod ?? 'equal')
  const [equalParticipantIds, setEqualParticipantIds] = useState<string[]>(() => {
    if (expense?.splitMethod !== 'equal') return members.map(member => member.id)
    const savedParticipantIds = new Set(Object.keys(expense.shares))
    return members.filter(member => savedParticipantIds.has(member.id)).map(member => member.id)
  })
  const [exactShares, setExactShares] = useState<Record<string, string>>(() => expense?.splitMethod === 'exact'
    ? Object.fromEntries(members.map(member => [member.id, expense.shares[member.id]?.toString() ?? '']))
    : {})
  const numericAmount = Number(amount) || 0
  const equalParticipants = members.filter(member => equalParticipantIds.includes(member.id))
  const exactTotal = members.reduce((sum, member) => sum + (Number(exactShares[member.id]) || 0), 0)
  const remaining = numericAmount - exactTotal
  const exactValid = Math.abs(remaining) < 0.005
  const splitValid = method === 'equal' ? equalParticipants.length > 0 : exactValid

  const toggleEqualParticipant = (memberId: string) => {
    setEqualParticipantIds(current => current.includes(memberId)
      ? current.filter(id => id !== memberId)
      : [...current, memberId])
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || numericAmount <= 0 || !splitValid) return
    const shares = method === 'equal'
      ? createEqualShares(equalParticipants, numericAmount)
      : createExactShares(members, exactShares)
    const savedAt = createExpenseTimestamp()
    onSave({
      id: expense?.id ?? makeId('expense'),
      groupId: group.id,
      title: title.trim(),
      amount: numericAmount,
      payerId,
      splitMethod: method,
      shares,
      createdAt: expense?.createdAt ?? savedAt,
      ...(expense ? { updatedAt: savedAt } : {}),
    })
  }

  return (
    <ModalShell eyebrow={group.name} title={expense ? 'Edit expense' : 'Add a shared expense'} onClose={onClose}>
      <form onSubmit={submit}>
        <label>Description<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Groceries" required /></label>
        <label>Amount<span className="modal-amount"><i>$</i><input aria-label="Amount" value={amount} onChange={event => setAmount(event.target.value)} type="number" min="0.01" step="0.01" placeholder="0.00" required /></span></label>
        <div className="form-grid">
          <label>Paid by<select value={payerId} onChange={event => setPayerId(event.target.value)}>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
          <label>Split method<select value={method} onChange={event => setMethod(event.target.value as SplitMethod)}><option value="equal">Equally</option><option value="exact">Exact amounts</option></select></label>
        </div>
        {method === 'equal' ? (
          <div className="equal-splits">
            <div className="equal-heading"><span>Split between</span><b>{equalParticipants.length} of {members.length} selected</b></div>
            <div className="equal-member-list">
              {members.map(member => (
                <label className="equal-member" key={member.id}>
                  <span><Avatar member={member} size="sm" />{member.name}</span>
                  <input
                    aria-label={`Include ${member.name} in equal split`}
                    type="checkbox"
                    checked={equalParticipantIds.includes(member.id)}
                    onChange={() => toggleEqualParticipant(member.id)}
                  />
                </label>
              ))}
            </div>
            <div className="split-preview">
              <span><Users size={18} />Each selected person’s share</span>
              <strong>{equalParticipants.length ? money(numericAmount / equalParticipants.length) : '$0.00'}</strong>
            </div>
            {equalParticipants.length ? null : <small className="split-error" role="alert">Select at least one person to split this expense.</small>}
          </div>
        ) : (
          <div className="exact-splits">
            <div className="exact-heading"><span>Enter each share</span><b className={exactValid ? 'positive' : remaining < 0 ? 'negative' : ''}>{remaining >= 0 ? `${money(remaining)} left` : `${money(remaining)} over`}</b></div>
            {members.map(member => <label className="share-row" key={member.id}><span><Avatar member={member} size="sm" />{member.name}</span><span className="share-input"><i>$</i><input aria-label={`${member.name} share`} type="number" min="0" step="0.01" value={exactShares[member.id] ?? ''} onChange={event => setExactShares(current => ({ ...current, [member.id]: event.target.value }))} placeholder="0.00" /></span></label>)}
          </div>
        )}
        {expense ? <div className="split-note edit-note"><Pencil size={17} /><span>{method === 'equal' ? 'Saving replaces this expense’s split using the selected people.' : `Saving replaces this expense’s split using all ${members.length} current activity members.`}</span></div> : null}
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="confirm-button" type="submit" disabled={!splitValid}>{expense ? 'Save changes' : 'Save expense'}</button></div>
      </form>
    </ModalShell>
  )
}
