import { useEffect, type ReactNode } from 'react'
import { ChevronRight, Link2, QrCode, Radio, Share2, X } from 'lucide-react'
import { useLocalization } from '../../i18n/LocalizationContext'

type ShareAction = () => void | Promise<void>

function ShareMenuAction({ icon, title, description, onClick }: {
  icon: ReactNode
  title: string
  description: string
  onClick: ShareAction
}) {
  return (
    <button type="button" className="share-menu-action" onClick={onClick}>
      <span className="share-menu-icon">{icon}</span>
      <span className="share-menu-copy"><b>{title}</b><small>{description}</small></span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  )
}

export function ShareActivityMenu({ groupName, live = false, onClose, onCollaborateLive, onCopyLink, onShowQr, onShareSummary }: {
  groupName: string
  live?: boolean
  onClose: () => void
  onCollaborateLive?: ShareAction
  onCopyLink?: ShareAction
  onShowQr?: ShareAction
  onShareSummary?: ShareAction
}) {
  const { t } = useLocalization()
  const run = (action: ShareAction) => {
    onClose()
    void action()
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="share-menu-backdrop" role="presentation" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose()
    }}>
      <section className="share-menu" role="dialog" aria-modal="true" aria-labelledby="share-menu-title">
        <header className="share-menu-header">
          <div><h2 id="share-menu-title">{t('shareMenu.title')}</h2><p>{t('shareMenu.description', { name: groupName })}</p></div>
          <button type="button" className="share-menu-close" aria-label={t('common.close')} onClick={onClose}><X size={20} /></button>
        </header>
        <div className="share-menu-actions">
          {onCollaborateLive ? <ShareMenuAction icon={<Radio size={20} />} title={t('shareMenu.collaborate')} description={t('shareMenu.collaborateHelp')} onClick={() => run(onCollaborateLive)} /> : null}
          {onCopyLink ? <ShareMenuAction icon={<Link2 size={20} />} title={t(live ? 'shareMenu.copyLive' : 'shareMenu.copyLink')} description={t(live ? 'shareMenu.copyLiveHelp' : 'shareMenu.copyLinkHelp')} onClick={() => run(onCopyLink)} /> : null}
          {onShowQr ? <ShareMenuAction icon={<QrCode size={20} />} title={t('shareMenu.showQr')} description={t('shareMenu.showQrHelp')} onClick={() => run(onShowQr)} /> : null}
          {onShareSummary ? <ShareMenuAction icon={<Share2 size={20} />} title={t('shareMenu.summary')} description={t('shareMenu.summaryHelp')} onClick={() => run(onShareSummary)} /> : null}
        </div>
        <button type="button" className="share-menu-cancel" onClick={onClose}>{t('common.cancel')}</button>
      </section>
    </div>
  )
}
