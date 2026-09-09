import { ShieldCheck, UserMinus } from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
import { isSettlementPayment } from '../../domain/expenses'
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
  const { t } = useLocalization()
  const references = memberExpenseReferences(expenses, group.id, member.id)
  const blocked = references.length > 0

  return (
    <ModalShell eyebrow={t('dashboard.people')} title={t(blocked ? 'removeFriend.blockedTitle' : 'removeFriend.title', { name: member.name })}
      onClose={busy ? undefined : onClose} mobilePlacement="center" bodyClassName="remove-friend-dialog">
      <div className="remove-friend-person"><Avatar member={member} /><div><b>{member.name}</b><small>{group.name}</small></div></div>
      <p>{t(blocked ? 'removeFriend.blockedDescription' : 'removeFriend.description', { name: member.name })}</p>
      {blocked ? <div className="remove-friend-history">
        <b>{t('removeFriend.history', { count: references.length })}</b>
        <ul>{references.slice(0, 3).map(expense => <li key={expense.id}>{isSettlementPayment(expense) ? t('dashboard.settlementPayment') : expense.title}</li>)}</ul>
        {references.length > 3 ? <small>{t('removeFriend.more', { count: references.length - 3 })}</small> : null}
      </div> : null}
      <div className="remove-friend-note"><ShieldCheck size={19} aria-hidden="true" /><p>{t(blocked ? 'removeFriend.preserve' : live ? 'removeFriend.liveNotice' : 'removeFriend.localNotice')}</p></div>
      {readOnly ? <p role="alert" className="form-error">{t('removeFriend.offline')}</p> : error ? <p role="alert" className="form-error">{error}</p> : null}
      <div className="modal-actions">
        <Button onClick={onClose} disabled={busy}>{t(blocked ? 'common.close' : 'common.cancel')}</Button>
        {blocked ? null : <Button variant="danger" onClick={() => void onRemove()} disabled={busy || readOnly}>
          <UserMinus size={17} />{t(busy ? 'common.loading' : 'removeFriend.action')}
        </Button>}
      </div>
    </ModalShell>
  )
}
