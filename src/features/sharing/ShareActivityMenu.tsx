import { type ReactNode } from 'react'
import { ChevronRight, CircleStop, Copy, QrCode, Radio, Share2 } from 'lucide-react'
import { Button } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
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

export function ShareActivityMenu({ groupName, live = false, onClose, onCollaborateLive, onCopyLink, onShowQr, onShareSummary, onEndLive }: {
  groupName: string
  live?: boolean
  onClose: () => void
  onCollaborateLive?: ShareAction
  onCopyLink?: ShareAction
  onShowQr?: ShareAction
  onShareSummary?: ShareAction
  onEndLive?: ShareAction
}) {
  const { t } = useLocalization()
  const run = (action: ShareAction) => {
    onClose()
    void action()
  }

  return (
    <ModalShell
      title={t('shareMenu.title')}
      description={t('shareMenu.description', { name: groupName })}
      onClose={onClose}
      size="wide"
      bodyClassName="share-menu-body"
    >
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
        {live && onEndLive ? (
          <div className="share-menu-danger">
            <span className="share-menu-danger-copy"><CircleStop size={18} /><span><b>{t('shareMenu.endLive')}</b><small>{t('shareMenu.endLiveHelp')}</small></span></span>
            <Button variant="danger" onClick={() => run(onEndLive)}>{t('shareMenu.endLiveAction')}</Button>
          </div>
        ) : null}
        <Button className="share-menu-cancel" onClick={onClose}>{t('common.cancel')}</Button>
    </ModalShell>
  )
}
