import { useState, type FormEvent } from 'react'
import { UserRoundCheck } from 'lucide-react'
import { ModalShell } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { SelectMenu } from '../../components/SelectMenu'
import type { Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export type LiveActivityIdentityMode = 'live-copy' | 'live-recovery'

export function LiveActivityIdentityModal({ members, mode, onClose, onSave }: {
  members: Member[]
  mode: LiveActivityIdentityMode
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
    : {
        eyebrow: t('live.recoverEyebrow'),
        title: t('live.recoverTitle'),
        explanation: t('live.recoverExplanation'),
        save: t('live.recoverSave'),
      }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!memberId) return
    onSave(memberId)
  }

  return (
    <ModalShell eyebrow={copy.eyebrow} title={copy.title} onClose={onClose} mobilePlacement="center">
      <form onSubmit={submit}>
        <label>{t('sharedIdentity.participant')}<SelectMenu autoFocus value={memberId} options={members.map(member => ({ value: member.id, label: member.name }))} onChange={setMemberId} ariaLabel={t('sharedIdentity.participant')} menuLabel={t('sharedIdentity.participant')} /></label>
        <div className="split-note identity-note"><UserRoundCheck size={18} /><span><b>{t('sharedIdentity.becomesYou')}</b><small>{copy.explanation}</small></span></div>
        <div className="modal-actions"><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={!memberId}>{copy.save}</Button></div>
      </form>
    </ModalShell>
  )
}
