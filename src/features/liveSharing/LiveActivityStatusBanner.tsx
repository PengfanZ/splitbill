import {
  CloudOff,
  CloudUpload,
  CopyPlus,
  History,
  RefreshCw,
} from 'lucide-react'
import { Button } from '../../components/Button'
import { useLocalization } from '../../i18n/LocalizationContext'
import type { LiveActivityConnectionState } from './useLiveActivitySession'

export function LiveActivityStatusBanner({
  state,
  code,
  notice,
  browserOnline,
  refreshing = false,
  hasBookmark = false,
  onBack,
  onRefresh,
  onDuplicate,
  onContinueLocally,
}: {
  state: LiveActivityConnectionState
  code?: string
  notice?: string | null
  browserOnline: boolean
  refreshing?: boolean
  hasBookmark?: boolean
  onBack?: () => void
  onRefresh?: () => void
  onDuplicate?: () => void
  onContinueLocally?: () => void
}) {
  const { t } = useLocalization()
  const connected = state === 'connected'
  const cached = state === 'cached'
  const expired = state === 'expired'
  const title = connected
    ? t('live.syncedTitle', { code: code ?? '' })
    : cached
      ? t(browserOnline ? 'live.reconnectingTitle' : 'live.offlineTitle')
      : expired
        ? t('live.endedTitle')
        : state === 'opening'
          ? t('live.opening')
          : t('live.unavailableTitle')
  const description = connected
    ? notice ?? t('live.syncedText')
    : cached
      ? t('live.cachedText')
      : expired
        ? t('live.endedText')
        : state === 'opening'
          ? t('live.loadingLatest')
          : notice ?? t('live.unavailableText')

  return (
    <section className={`live-status live-status--${state}`} aria-label={t('live.label')}>
      <span className="live-status-icon" aria-hidden="true">
        {connected ? <CloudUpload size={21} /> : expired ? <History size={21} /> : <CloudOff size={21} />}
      </span>
      <div className="live-status-copy">
        <strong>{title}</strong>
        <span role={notice && (connected || state === 'unavailable') ? 'status' : undefined}>{description}</span>
        {notice && (cached || expired) ? <small role="status">{notice}</small> : null}
      </div>
      <div className="live-status-actions">
        {!hasBookmark && onBack ? <Button onClick={onBack}>{t('live.back')}</Button> : null}
        {(connected || cached || state === 'unavailable') && browserOnline && onRefresh ? (
          <Button onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={15} />{refreshing ? t('common.loading') : t(connected ? 'live.refresh' : 'live.retry')}
          </Button>
        ) : null}
        {cached && onDuplicate ? (
          <Button variant="primary" onClick={onDuplicate}>
            <CopyPlus size={15} />{t('live.duplicate')}
          </Button>
        ) : null}
        {expired && onContinueLocally ? (
          <Button variant="primary" onClick={onContinueLocally}>
            <CopyPlus size={15} />{t('live.continueLocally')}
          </Button>
        ) : null}
      </div>
    </section>
  )
}
