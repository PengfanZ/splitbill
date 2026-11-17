import { useEffect, useRef } from 'react'
import { AppWindow, ExternalLink, MonitorDown, Share, Smartphone } from 'lucide-react'
import { Button } from '../../components/Button'
import { useLocalization } from '../../i18n/LocalizationContext'
import { openNativeInstallPrompt, type InstallGuide } from '../../pwa/installGuide'

export type InstallPromptOutcome = 'accepted' | 'dismissed'

const ICONS = { native: MonitorDown, ios: Smartphone, 'mac-safari': AppWindow, 'in-app': ExternalLink }

/** One-time card that tells people how to install Tally in the browser they are using. */
export function InstallPromptCard({ guide, onShown, onClose }: {
  guide: InstallGuide
  onShown: () => void
  onClose: (outcome: InstallPromptOutcome) => void
}) {
  const { t } = useLocalization()
  const shown = useRef(false)
  const Icon = ICONS[guide]

  useEffect(() => {
    if (shown.current) return
    shown.current = true
    onShown()
  }, [onShown])

  const install = async () => onClose(await openNativeInstallPrompt())

  return (
    <section className="install-prompt" aria-label={t('install.label')}>
      <div>
        <Icon size={18} aria-hidden="true" />
        <span>
          {guide === 'native' ? <><b>{t('install.nativeTitle')}</b><small>{t('install.nativeText')}</small></> : null}
          {guide === 'ios' ? (
            <>
              <b>{t('install.iosTitle')}</b>
              <small>{t('install.iosText')}</small>
              <ol>
                <li>{t('install.iosStepMore')}</li>
                <li>{t('install.iosStepShare')} <Share size={14} aria-hidden="true" /></li>
                <li>{t('install.iosStepAdd')}</li>
                <li>{t('install.iosStepConfirm')}</li>
              </ol>
              <small>{t('install.separateData')}</small>
            </>
          ) : null}
          {guide === 'mac-safari' ? (
            <>
              <b>{t('install.macTitle')}</b>
              <small>{t('install.macText')}</small>
              <small className="install-prompt-step">{t('install.macStep')}</small>
              <small>{t('install.separateData')}</small>
            </>
          ) : null}
          {guide === 'in-app' ? <><b>{t('install.inAppTitle')}</b><small>{t('install.inAppText')}</small></> : null}
        </span>
      </div>
      <div className="install-prompt-actions">
        {guide === 'native' ? (
          <>
            <Button variant="ghost" onClick={() => onClose('dismissed')}>{t('install.notNow')}</Button>
            <Button variant="primary" onClick={install}>{t('install.install')}</Button>
          </>
        ) : <Button onClick={() => onClose('dismissed')}>{t('install.gotIt')}</Button>}
      </div>
    </section>
  )
}
