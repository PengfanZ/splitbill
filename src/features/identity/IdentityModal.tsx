import { useState, type FormEvent } from 'react'
import { UserRound } from 'lucide-react'
import { ModalShell } from '../../components/AppShell'

export function IdentityModal({ initialName = '', onClose, onSave }: {
  initialName?: string
  onClose?: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(initialName)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSave(name.trim())
  }

  return (
    <ModalShell eyebrow="Your local identity" title="What should we call you?" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Display name<input aria-label="Display name" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Pengfan" required /></label>
        <div className="split-note identity-note"><UserRound size={18} /><span><b>Stored only in this browser</b><small>Your name identifies “You” in activities and lets friends recognize the sender of a shared link.</small></span></div>
        <div className="modal-actions modal-actions--single"><button className="confirm-button" type="submit">{initialName ? 'Save name' : 'Continue'}</button></div>
      </form>
    </ModalShell>
  )
}
