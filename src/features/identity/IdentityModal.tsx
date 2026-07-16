import { useState, type FormEvent } from 'react'
import { Globe2, UserRound } from 'lucide-react'
import { ModalShell } from '../../components/AppShell'
import { useLocalization } from '../../i18n/LocalizationContext'
import type { AppLocale } from '../../i18n/localization'

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
    <ModalShell eyebrow={t(settingsMode ? 'identity.settingsEyebrow' : 'identity.eyebrow')} title={t(settingsMode ? 'identity.settingsTitle' : 'identity.title')} onClose={onClose}>
      <form onSubmit={submit}>
        <label>{t('identity.displayName')}<input aria-label={t('identity.displayName')} autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t('identity.namePlaceholder')} required /></label>
        <label>{t('settings.language')}<select aria-label={t('settings.language')} value={locale} onChange={event => setLocale(event.target.value as AppLocale)}><option value="en">{t('settings.english')}</option><option value="zh-CN">{t('settings.chinese')}</option></select></label>
        <div className="split-note identity-note"><Globe2 size={18} /><span><b>{t('settings.regionTitle')}</b><small>{t('settings.timeZone', { timeZone })}</small></span></div>
        <div className="split-note identity-note"><UserRound size={18} /><span><b>{t('identity.storedLocally')}</b><small>{t('identity.explanation')}</small></span></div>
        <div className="modal-actions modal-actions--single"><button className="confirm-button" type="submit">{t(initialName ? 'identity.saveName' : 'identity.continue')}</button></div>
      </form>
    </ModalShell>
  )
}
