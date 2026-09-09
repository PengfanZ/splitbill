import { ShieldCheck, UserMinus } from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
import { calculateMemberBalance, isSettlementPayment, money } from '../../domain/expenses'
import { activityCurrency } from '../../domain/currency'
import { memberExpenseReferences } from '../../domain/memberRemoval'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export function RemoveFriendModal({ member, group, expenses, live, busy, readOnly, error, onClose, onRemove }: {
  member: Member
  group: ActivityGroup
  expenses: Expense[]
  live: boolean
  busy: boolean
  readOnly: boolean
  error: string | null
  onClose: () => void
  onRemove: () => void | Promise<void>
}) {
  const { t, locale, formatDateTime } = useLocalization()
  const references = memberExpenseReferences(expenses, group.id, member.id)
  const balance = calculateMemberBalance(member.id, expenses.filter(expense => expense.groupId === group.id))
  const formatMoney = (amount: number) => money(amount, activityCurrency(group), locale)

  return (
    <ModalShell eyebrow={t('dashboard.people')} title={t('removeFriend.title', { name: member.name })}
      onClose={busy ? undefined : onClose} mobilePlacement="center" bodyClassName="remove-friend-dialog">
      <div className="remove-friend-person"><Avatar member={member} /><div><b>{member.name}</b><small>{group.name}</small></div></div>
      <p>{t('removeFriend.description', { name: member.name })}</p>
      {references.length ? <div className="remove-friend-history">
        <b>{t('removeFriend.history', { count: references.length })}</b>
        <ul tabIndex={0} aria-label={t('removeFriend.history', { count: references.length })}>{references.map(expense => <li key={expense.id}>
          <b>{isSettlementPayment(expense) ? t('dashboard.settlementPayment') : expense.title}</b>
          <small>{formatDateTime(expense.updatedAt ?? expense.createdAt) ?? expense.createdAt}</small>
          {isSettlementPayment(expense)
            ? <span>{t(expense.payerId === member.id ? 'removeFriend.sent' : 'removeFriend.received', { amount: formatMoney(expense.amount) })}</span>
            : <><span>{t('removeFriend.billShare', { total: formatMoney(expense.amount), share: formatMoney(expense.shares[member.id] ?? 0) })}</span>
              {expense.payerId === member.id ? <small>{t('removeFriend.paidBill', { name: member.name })}</small> : null}</>}
        </li>)}</ul>
        <p className="remove-friend-balance">{t(balance > 0 ? 'removeFriend.isOwed' : balance < 0 ? 'removeFriend.owes' : 'removeFriend.settled', { name: member.name, amount: formatMoney(Math.abs(balance)) })}</p>
      </div> : null}
      <div className="remove-friend-note"><ShieldCheck size={19} aria-hidden="true" /><p>{t('removeFriend.preserve')}</p></div>
      <p className="remove-friend-scope">{t(live ? 'removeFriend.liveNotice' : 'removeFriend.localNotice')}</p>
      {readOnly ? <p role="alert" className="form-error">{t('removeFriend.offline')}</p> : error ? <p role="alert" className="form-error">{error}</p> : null}
      <div className="modal-actions">
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="danger" onClick={() => void onRemove()} disabled={busy || readOnly}>
          <UserMinus size={17} />{t(busy ? 'common.loading' : 'removeFriend.action')}
        </Button>
      </div>
    </ModalShell>
  )
}
