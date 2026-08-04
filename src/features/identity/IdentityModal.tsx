import { useState, type FormEvent } from 'react'
import { Globe2, UserRound } from 'lucide-react'
import { ModalShell } from '../../components/Dialog'
import { Button } from '../../components/Button'
import { useLocalization } from '../../i18n/LocalizationContext'
import { LanguageControl } from './LanguageControl'

export function IdentityModal({ initialName = '', onClose, onSave }: {
  initialName?: string
  onClose?: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(initialName)
  const { locale, setLocale, t, timeZone } = useLocalization()
  const settingsMode = Boolean(initialName)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSave(name.trim())
  }

  return (
    <ModalShell eyebrow={t(settingsMode ? 'identity.settingsEyebrow' : 'identity.eyebrow')} title={t(settingsMode ? 'identity.settingsTitle' : 'identity.title')} onClose={onClose} mobilePlacement="center">
      <form onSubmit={submit}>
        <label>{t('identity.displayName')}<input aria-label={t('identity.displayName')} autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t('identity.namePlaceholder')} required /></label>
        <div className="language-field"><span>{t('settings.language')}</span><LanguageControl locale={locale} onChange={setLocale} /></div>
        <div className="split-note identity-note"><Globe2 size={18} /><span><b>{t('settings.regionTitle')}</b><small>{t('settings.timeZone', { timeZone })}</small></span></div>
        <div className="split-note identity-note"><UserRound size={18} /><span><b>{t('identity.storedLocally')}</b><small>{t('identity.explanation')}</small></span></div>
        <div className="modal-actions modal-actions--single"><Button variant="primary" type="submit">{t(initialName ? 'identity.saveName' : 'identity.continue')}</Button></div>
      </form>
    </ModalShell>
  )
}
