import { useState, type FormEvent } from 'react'
import { ArrowRight, CircleDollarSign, Pencil, Users } from 'lucide-react'
import { Avatar, ModalShell } from '../../components/AppShell'
import { createEqualShares, createExactShares, createExpenseTimestamp, createSettlementPayment, money } from '../../domain/expenses'
import { makeId } from '../../domain/members'
import type { ActivityGroup, Expense, Member, Settlement, SplitMethod } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export function CreateGroupModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, friendNames: string[]) => void }) {
  const [name, setName] = useState('')
  const [friends, setFriends] = useState('')
  const { t } = useLocalization()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSave(name.trim(), friends.split(',').map(friend => friend.trim()).filter(Boolean))
  }

  return (
    <ModalShell eyebrow={t('group.newEyebrow')} title={t('group.newTitle')} onClose={onClose} mobilePlacement="center">
      <form onSubmit={submit}>
        <label>{t('group.name')}<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t('group.namePlaceholder')} required /></label>
        <label>{t('group.addFriends')} <small>{t('group.addFriendsHelp')}</small><textarea value={friends} onChange={event => setFriends(event.target.value)} placeholder={t('group.addFriendsPlaceholder')} rows={3} /></label>
        <div className="split-note"><Users size={18} /><span>{t('group.included')}</span></div>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>{t('common.cancel')}</button><button className="confirm-button" type="submit">{t('group.create')}</button></div>
      </form>
    </ModalShell>
  )
}

export function AddFriendModal({ existingExpenseCount, onClose, onSave }: { existingExpenseCount: number; onClose: () => void; onSave: (names: string[]) => void }) {
  const [names, setNames] = useState('')
  const { t } = useLocalization()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = names.split(',').map(name => name.trim()).filter(Boolean)
    if (!parsed.length) return
    onSave(parsed)
  }

  return (
    <ModalShell eyebrow={t('friend.eyebrow')} title={t('friend.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <label>{t('friend.names')} <small>{t('friend.namesHelp')}</small><textarea autoFocus value={names} onChange={event => setNames(event.target.value)} placeholder={t('friend.namesPlaceholder')} rows={3} required /></label>
        {existingExpenseCount ? <div className="split-note future-note"><Users size={18} /><span><b>{t('friend.futureOnly')}</b><small>{t(existingExpenseCount === 1 ? 'friend.existingOne' : 'friend.existingMany', { count: existingExpenseCount })}</small></span></div> : null}
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>{t('common.cancel')}</button><button className="confirm-button" type="submit">{t('friend.add')}</button></div>
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
  const { t } = useLocalization()
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
    <ModalShell eyebrow={group.name} title={t('settlement.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="settlement-parties" aria-label={t('settlement.parties', { from: settlement.from.name, to: settlement.to.name })}>
          <span><Avatar member={settlement.from} /><b>{settlement.from.name}</b><small>{t('settlement.pays')}</small></span>
          <ArrowRight size={20} />
          <span><Avatar member={settlement.to} /><b>{settlement.to.name}</b><small>{t('settlement.receives')}</small></span>
        </div>
        <label>{t('settlement.amount')} <small>{t('settlement.suggestedAmount', { amount: money(settlement.amount) })}</small><span className="modal-amount"><i>$</i><input autoFocus aria-label={t('settlement.amount')} value={amount} onChange={event => setAmount(event.target.value)} type="number" min="0.01" max={settlement.amount.toFixed(2)} step="0.01" required /></span></label>
        {valid ? null : <small className="split-error" role="alert">{t('settlement.invalid', { amount: money(settlement.amount) })}</small>}
        <div className="split-note settlement-note"><CircleDollarSign size={18} /><span>{t('settlement.note')}</span></div>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>{t('common.cancel')}</button><button className="confirm-button" type="submit" disabled={!valid}>{t('settlement.record')}</button></div>
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
  const { t } = useLocalization()
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
    <ModalShell eyebrow={group.name} title={t(expense ? 'expense.editTitle' : 'expense.addTitle')} onClose={onClose}>
      <form onSubmit={submit}>
        <label>{t('expense.description')}<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder={t('expense.descriptionPlaceholder')} required /></label>
        <label>{t('expense.amount')}<span className="modal-amount"><i>$</i><input aria-label={t('expense.amount')} value={amount} onChange={event => setAmount(event.target.value)} type="number" min="0.01" step="0.01" placeholder="0.00" required /></span></label>
        <div className="form-grid">
          <label>{t('expense.paidBy')}<select value={payerId} onChange={event => setPayerId(event.target.value)}>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
          <label>{t('expense.splitMethod')}<select value={method} onChange={event => setMethod(event.target.value as SplitMethod)}><option value="equal">{t('expense.equally')}</option><option value="exact">{t('expense.exactAmounts')}</option></select></label>
        </div>
        {method === 'equal' ? (
          <div className="equal-splits">
            <div className="equal-heading"><span>{t('expense.splitBetween')}</span><b>{t('expense.selectedCount', { selected: equalParticipants.length, total: members.length })}</b></div>
            <div className="equal-member-list">
              {members.map(member => (
                <label className="equal-member" key={member.id}>
                  <span><Avatar member={member} size="sm" />{member.name}</span>
                  <input
                    aria-label={t('expense.includeMember', { name: member.name })}
                    type="checkbox"
                    checked={equalParticipantIds.includes(member.id)}
                    onChange={() => toggleEqualParticipant(member.id)}
                  />
                </label>
              ))}
            </div>
            <div className="split-preview">
              <span><Users size={18} />{t('expense.eachShare')}</span>
              <strong>{equalParticipants.length ? money(numericAmount / equalParticipants.length) : '$0.00'}</strong>
            </div>
            {equalParticipants.length ? null : <small className="split-error" role="alert">{t('expense.selectOne')}</small>}
          </div>
        ) : (
          <div className="exact-splits">
            <div className="exact-heading"><span>{t('expense.enterShares')}</span><b className={exactValid ? 'positive' : remaining < 0 ? 'negative' : ''}>{t(remaining >= 0 ? 'expense.left' : 'expense.over', { amount: money(remaining) })}</b></div>
            {members.map(member => <label className="share-row" key={member.id}><span><Avatar member={member} size="sm" />{member.name}</span><span className="share-input"><i>$</i><input aria-label={t('expense.memberShare', { name: member.name })} type="number" min="0" step="0.01" value={exactShares[member.id] ?? ''} onChange={event => setExactShares(current => ({ ...current, [member.id]: event.target.value }))} placeholder="0.00" /></span></label>)}
          </div>
        )}
        {expense ? <div className="split-note edit-note"><Pencil size={17} /><span>{method === 'equal' ? t('expense.editEqualNote') : t('expense.editExactNote', { count: members.length })}</span></div> : null}
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>{t('common.cancel')}</button><button className="confirm-button" type="submit" disabled={!splitValid}>{t(expense ? 'expense.saveChanges' : 'expense.save')}</button></div>
      </form>
    </ModalShell>
  )
}
