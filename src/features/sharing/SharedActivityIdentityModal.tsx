import { useState, type FormEvent } from 'react'
import { UserRoundCheck } from 'lucide-react'
import { ModalShell } from '../../components/AppShell'
import type { Member } from '../../domain/models'

export function SharedActivityIdentityModal({ members, onClose, onSave }: {
  members: Member[]
  onClose: () => void
  onSave: (memberId: string) => void
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? '')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!memberId) return
    onSave(memberId)
  }

  return (
    <ModalShell eyebrow="Save shared activity" title="Who are you in this activity?" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Your participant<select aria-label="Your participant" autoFocus value={memberId} onChange={event => setMemberId(event.target.value)}>{members.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label>
        <div className="split-note identity-note"><UserRoundCheck size={18} /><span><b>This participant becomes “You”</b><small>Every payer, split, and balance will be remapped consistently in your local copy.</small></span></div>
        <div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="confirm-button" type="submit" disabled={!memberId}>Save my copy</button></div>
      </form>
    </ModalShell>
  )
}
