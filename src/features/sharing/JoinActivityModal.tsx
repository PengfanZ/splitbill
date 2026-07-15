import { useState } from 'react'
import { ClipboardPaste, Link2, Smartphone } from 'lucide-react'
import { ModalShell } from '../../components/AppShell'
import { copyLink } from './shareLink'
import { extractSharedActivityHash } from './sharedLinkHandoff'

export function JoinActivityModal({ onClose, onJoin }: { onClose: () => void; onJoin: (hash: string) => void }) {
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)

  const pasteLink = async () => {
    if (typeof navigator.clipboard?.readText !== 'function') {
      setError('Paste the shared link into the field manually.')
      return
    }
    try {
      setLink(await navigator.clipboard.readText())
      setError(null)
    } catch {
      setError('Tally could not read the clipboard. Paste the link manually.')
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const hash = extractSharedActivityHash(link)
    if (!hash) {
      setError('Paste a valid Tally live link or snapshot link.')
      return
    }
    onJoin(hash)
  }

  return (
    <ModalShell eyebrow="PWA handoff" title="Join a shared activity" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="split-note identity-note"><Smartphone size={18} /><span><b>Continue in your installed Tally app</b><small>If Safari opened the link in a separate browser session, copy it there, return to Tally, and paste it below.</small></span></div>
        <label>Shared activity link<textarea aria-label="Shared activity link" value={link} onChange={event => { setLink(event.target.value); setError(null) }} placeholder="https://pengfanz.github.io/splitbill/#live=…" autoFocus /></label>
        {error ? <p className="split-error" role="alert">{error}</p> : null}
        <div className="modal-actions"><button type="button" className="outline-button qr-copy-button" onClick={pasteLink}><ClipboardPaste size={16} />Paste link</button><button className="confirm-button qr-copy-button" type="submit"><Link2 size={16} />Open activity</button></div>
      </form>
    </ModalShell>
  )
}

export function BrowserToPwaHandoff({ url }: { url: string }) {
  const [message, setMessage] = useState('Safari cannot automatically switch this link into an installed web app.')

  const copyForApp = async () => {
    const result = await copyLink(url)
    setMessage(result === 'copied'
      ? 'Link copied. Open the Tally app, choose Join activity, and paste it.'
      : 'Copy this page’s URL, then open the Tally app and choose Join activity.')
  }

  return (
    <section className="pwa-handoff" aria-label="Continue in installed Tally">
      <div><Smartphone size={18} /><span><b>Already installed Tally?</b><small aria-live="polite">{message}</small></span></div>
      <button type="button" className="outline-button" onClick={copyForApp}>Copy for app</button>
    </section>
  )
}
