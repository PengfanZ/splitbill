import { useState, type FormEvent } from 'react'
import { UserRoundCheck } from 'lucide-react'
import { ModalShell } from '../../components/AppShell'
import type { Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export function SharedActivityIdentityModal({ members, onClose, onSave }: {
  members: Member[]
  onClose: () => void
  onSave: (memberId: string) => void
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? '')
  const { t } = useLocalization()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!memberId) return
    onSave(memberId)
  }

  return (
    <ModalShell eyebrow={t('sharedIdentity.eyebrow')} title={t('sharedIdentity.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <label>{t('sharedIdentity.participant')}<select aria-label={t('sharedIdentity.participant')} autoFocus value={memberId} onChange={event => setMemberId(event.target.value)}>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
        <div className="split-note identity-note"><UserRoundCheck size={18} /><span><b>{t('sharedIdentity.becomesYou')}</b><small>{t('sharedIdentity.explanation')}</small></span></div>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>{t('common.cancel')}</button><button className="confirm-button" type="submit" disabled={!memberId}>{t('sharedIdentity.save')}</button></div>
      </form>
    </ModalShell>
  )
}
