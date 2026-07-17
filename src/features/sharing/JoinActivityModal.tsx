import { useState } from 'react'
import { ClipboardPaste, Link2, Smartphone } from 'lucide-react'
import { ModalShell } from '../../components/AppShell'
import { useLocalization } from '../../i18n/LocalizationContext'
import { copyLink } from './shareLink'
import { extractSharedActivityHash } from './sharedLinkHandoff'

export function JoinActivityModal({ onClose, onJoin }: { onClose: () => void; onJoin: (hash: string) => void }) {
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { t } = useLocalization()

  const pasteLink = async () => {
    if (typeof navigator.clipboard?.readText !== 'function') {
      setError(t('join.manualPaste'))
      return
    }
    try {
      setLink(await navigator.clipboard.readText())
      setError(null)
    } catch {
      setError(t('join.clipboardFailed'))
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const hash = extractSharedActivityHash(link)
    if (!hash) {
      setError(t('join.invalid'))
      return
    }
    onJoin(hash)
  }

  return (
    <ModalShell eyebrow={t('join.eyebrow')} title={t('join.title')} onClose={onClose} mobilePlacement="center">
      <form onSubmit={submit}>
        <div className="split-note identity-note"><Smartphone size={18} /><span><b>{t('join.continueTitle')}</b><small>{t('join.continueText')}</small></span></div>
        <label>{t('join.link')}<textarea aria-label={t('join.link')} value={link} onChange={event => { setLink(event.target.value); setError(null) }} placeholder="https://pengfanz.github.io/splitbill/#live=…" autoFocus /></label>
        {error ? <p className="split-error" role="alert">{error}</p> : null}
        <div className="modal-actions"><button type="button" className="outline-button qr-copy-button" onClick={pasteLink}><ClipboardPaste size={16} />{t('join.paste')}</button><button className="confirm-button qr-copy-button" type="submit"><Link2 size={16} />{t('join.open')}</button></div>
      </form>
    </ModalShell>
  )
}

export function BrowserToPwaHandoff({ url }: { url: string }) {
  const { t } = useLocalization()
  const [messageKey, setMessageKey] = useState<'handoff.default' | 'handoff.copied' | 'handoff.manual'>('handoff.default')

  const copyForApp = async () => {
    const result = await copyLink(url)
    setMessageKey(result === 'copied' ? 'handoff.copied' : 'handoff.manual')
  }

  return (
    <section className="pwa-handoff" aria-label={t('handoff.label')}>
      <div><Smartphone size={18} /><span><b>{t('handoff.title')}</b><small aria-live="polite">{t(messageKey)}</small></span></div>
      <button type="button" className="outline-button" onClick={copyForApp}>{t('handoff.copy')}</button>
    </section>
  )
}
