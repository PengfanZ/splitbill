import { useEffect, type ReactNode } from 'react'
import { ChevronRight, Copy, QrCode, Radio, Share2, X } from 'lucide-react'
import { useLocalization } from '../../i18n/LocalizationContext'

type ShareAction = () => void | Promise<void>

function ShareChoice({ icon, badge, title, description, children }: {
  icon: ReactNode
  badge: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="share-choice share-choice--live">
      <div className="share-choice-heading">
        <span className="share-choice-icon">{icon}</span>
        <span className="share-choice-badge">{badge}</span>
      </div>
      <div className="share-choice-copy"><h3>{title}</h3><p>{description}</p></div>
      <div className="share-choice-actions">{children}</div>
    </section>
  )
}

function ShareChoiceAction({ icon, label, primary = false, onClick }: {
  icon: ReactNode
  label: string
  primary?: boolean
  onClick: ShareAction
}) {
  return (
    <button type="button" className={primary ? 'share-choice-action share-choice-action--primary' : 'share-choice-action'} onClick={onClick}>
      {icon}<span>{label}</span><ChevronRight size={16} aria-hidden="true" />
    </button>
  )
}

function ShareSummaryAction({ icon, title, description, onClick }: {
  icon: ReactNode
  title: string
  description: string
  onClick: ShareAction
}) {
  return (
    <button type="button" className="share-summary-action" onClick={onClick}>
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
        <div className="share-menu-choices">
          {onCollaborateLive ? (
            <ShareChoice
              icon={<Radio size={21} />}
              badge={t('shareMenu.liveBadge')}
              title={t('shareMenu.liveTitle')}
              description={t('shareMenu.liveHelp')}
            >
              <ShareChoiceAction icon={<Radio size={16} />} label={t('shareMenu.startLive')} primary onClick={() => run(onCollaborateLive)} />
            </ShareChoice>
          ) : null}
          {live && (onCopyLink || onShowQr) ? (
            <ShareChoice
              icon={<Radio size={21} />}
              badge={t('shareMenu.liveBadge')}
              title={t('shareMenu.currentLiveTitle')}
              description={t('shareMenu.liveHelp')}
            >
              {onCopyLink ? <ShareChoiceAction icon={<Copy size={16} />} label={t('shareMenu.copyLive')} primary onClick={() => run(onCopyLink)} /> : null}
              {onShowQr ? <ShareChoiceAction icon={<QrCode size={16} />} label={t('shareMenu.liveQr')} onClick={() => run(onShowQr)} /> : null}
            </ShareChoice>
          ) : null}
        </div>
        {onShareSummary ? <div className="share-menu-other"><span>{t('shareMenu.otherTitle')}</span><ShareSummaryAction icon={<Share2 size={20} />} title={t('shareMenu.summary')} description={t('shareMenu.summaryHelp')} onClick={() => run(onShareSummary)} /></div> : null}
        <button type="button" className="share-menu-cancel" onClick={onClose}>{t('common.cancel')}</button>
      </section>
    </div>
  )
}
