import { useState } from 'react'
import type { AnalyticsClient } from '../../analytics'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import type { AppLocale, Translate, TranslationKey } from '../../i18n/localization'
import type { CreateLiveActivityResult, LiveSession } from '../liveSharing/useLiveActivitySession'
import { buildLiveActivityUrl } from '../liveSharing/liveActivityLink'
import { exportActivitySummary, type ShareResult } from './shareActivity'
import { copyLink, shareLink, type LinkShareResult } from './shareLink'
import {
  buildSharedActivityQrUrl,
  buildSharedActivityUrl,
  createSharedActivity,
  type SharedActivity,
} from './shareActivityUrl'

export type ActivityFeedback = { groupId: string; message: string } | null
export type QrShare = {
  activity: SharedActivity
  url: string
  mode: 'snapshot' | 'live'
  activityCode?: string
}

type ActivitySharingOptions = {
  analyticsClient: AnalyticsClient | null
  createLiveActivity: (activity: SharedActivity, groupId: string) => Promise<CreateLiveActivityResult>
  locale: AppLocale
  notifyLive: (message: string) => void
  onLiveActivityCreated: () => void
  setActivityFeedback: (feedback: ActivityFeedback) => void
  t: Translate
}

const SUMMARY_MESSAGE_KEYS = {
  shared: 'feedback.summaryShared',
  copied: 'feedback.summaryCopied',
  downloaded: 'feedback.summaryDownloaded',
  cancelled: 'feedback.cancelled',
  failed: 'feedback.summaryFailed',
} satisfies Record<ShareResult, TranslationKey>

const LIVE_QR_MESSAGE_KEYS = {
  shared: 'feedback.liveShared',
  copied: 'feedback.liveCopied',
  cancelled: 'feedback.cancelled',
  failed: 'feedback.liveShareFailed',
} satisfies Record<LinkShareResult, TranslationKey>

const SNAPSHOT_QR_MESSAGE_KEYS = {
  shared: 'feedback.snapshotShared',
  copied: 'feedback.snapshotCopied',
  cancelled: 'feedback.cancelled',
  failed: 'feedback.snapshotFailed',
} satisfies Record<LinkShareResult, TranslationKey>

export function useActivitySharing({
  analyticsClient,
  createLiveActivity,
  locale,
  notifyLive,
  onLiveActivityCreated,
  setActivityFeedback,
  t,
}: ActivitySharingOptions) {
  const [qrShare, setQrShare] = useState<QrShare | null>(null)

  const shareGroup = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const result = await exportActivitySummary(group, members, expenses, locale)
    setActivityFeedback({ groupId: group.id, message: t(SUMMARY_MESSAGE_KEYS[result]) })
  }

  const openShareQr = (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const activity = createSharedActivity(group, members, expenses)
    try {
      setQrShare({ activity, url: buildSharedActivityQrUrl(activity), mode: 'snapshot' })
    } catch {
      setActivityFeedback({ groupId: group.id, message: t('feedback.qrTooLarge') })
    }
  }

  const copySnapshotLink = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    try {
      const result = await copyLink(buildSharedActivityUrl(createSharedActivity(group, members, expenses)))
      setActivityFeedback({
        groupId: group.id,
        message: t(result === 'copied' ? 'feedback.snapshotCopied' : 'feedback.snapshotFailed'),
      })
    } catch {
      setActivityFeedback({ groupId: group.id, message: t('feedback.snapshotTooLarge') })
    }
  }

  const openLiveShare = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    analyticsClient?.track('live_share_clicked', 'local', locale)
    setActivityFeedback({ groupId: group.id, message: t('live.creating') })
    const activity = createSharedActivity(group, members, expenses)
    const result = await createLiveActivity(activity, group.id)
    if (!result.ok) {
      setActivityFeedback({ groupId: group.id, message: result.message })
      return
    }
    onLiveActivityCreated()
    setActivityFeedback(null)
    analyticsClient?.track('live_activity_created', 'local', locale)
    setQrShare({ activity, url: result.url, mode: 'live', activityCode: result.code })
  }

  const openCurrentLiveQr = (session: LiveSession) => {
    setQrShare({
      activity: session.record.snapshot,
      url: buildLiveActivityUrl(session.credentials),
      mode: 'live',
      activityCode: session.record.code,
    })
  }

  const copyCurrentLiveLink = async (session: LiveSession) => {
    const result = await copyLink(buildLiveActivityUrl(session.credentials))
    notifyLive(t(result === 'copied' ? 'feedback.liveCopied' : 'feedback.liveCopyFailed'))
  }

  const reportQrShareResult = (share: QrShare, result: LinkShareResult) => {
    if (share.mode === 'live') {
      notifyLive(t(LIVE_QR_MESSAGE_KEYS[result]))
    } else {
      setActivityFeedback({
        groupId: share.activity.group.id,
        message: t(SNAPSHOT_QR_MESSAGE_KEYS[result]),
      })
    }
    if (result === 'shared' || result === 'copied') setQrShare(null)
  }

  const shareQrLink = async (share: QrShare) => {
    const result = await shareLink(
      t('share.linkTitle', { name: share.activity.group.name }),
      share.url,
      share.mode === 'live'
        ? t('share.liveLinkText', { name: share.activity.group.name })
        : t('share.snapshotLinkText', { name: share.activity.group.name }),
    )
    reportQrShareResult(share, result)
  }

  const copyQrLink = async (share: QrShare) => {
    const result = await copyLink(share.url)
    if (result === 'failed' && share.mode === 'live') {
      notifyLive(t('feedback.liveCopyFailed'))
      return
    }
    reportQrShareResult(share, result)
  }

  return {
    closeQrShare: () => setQrShare(null),
    copyCurrentLiveLink,
    copyQrLink,
    copySnapshotLink,
    openCurrentLiveQr,
    openLiveShare,
    openShareQr,
    qrShare,
    shareGroup,
    shareQrLink,
  }
}
