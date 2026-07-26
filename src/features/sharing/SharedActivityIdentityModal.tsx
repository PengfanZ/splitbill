import { useState, type FormEvent } from 'react'
import { UserRoundCheck } from 'lucide-react'
import { ModalShell } from '../../components/AppShell'
import type { Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export type SharedActivityIdentityMode = 'snapshot' | 'live-copy' | 'live-recovery'

export function SharedActivityIdentityModal({ members, mode = 'snapshot', onClose, onSave }: {
  members: Member[]
  mode?: SharedActivityIdentityMode
  onClose: () => void
  onSave: (memberId: string) => void
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? '')
  const { t } = useLocalization()
  const copy = mode === 'live-copy'
    ? {
        eyebrow: t('live.copyEyebrow'),
        title: t('live.copyTitle'),
        explanation: t('live.copyExplanation'),
        save: t('live.copySave'),
      }
    : mode === 'live-recovery'
      ? {
          eyebrow: t('live.recoverEyebrow'),
          title: t('live.recoverTitle'),
          explanation: t('live.recoverExplanation'),
          save: t('live.recoverSave'),
        }
      : {
          eyebrow: t('sharedIdentity.eyebrow'),
          title: t('sharedIdentity.title'),
          explanation: t('sharedIdentity.explanation'),
          save: t('sharedIdentity.save'),
        }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!memberId) return
    onSave(memberId)
  }

  return (
    <ModalShell eyebrow={copy.eyebrow} title={copy.title} onClose={onClose} mobilePlacement="center">
      <form onSubmit={submit}>
        <label>{t('sharedIdentity.participant')}<select aria-label={t('sharedIdentity.participant')} autoFocus value={memberId} onChange={event => setMemberId(event.target.value)}>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
        <div className="split-note identity-note"><UserRoundCheck size={18} /><span><b>{t('sharedIdentity.becomesYou')}</b><small>{copy.explanation}</small></span></div>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>{t('common.cancel')}</button><button className="confirm-button" type="submit" disabled={!memberId}>{copy.save}</button></div>
      </form>
    </ModalShell>
  )
}
