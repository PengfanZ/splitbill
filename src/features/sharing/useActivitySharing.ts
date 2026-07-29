import { useState } from 'react'
import type { AnalyticsClient } from '../../analytics'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import type { AppLocale, Translate, TranslationKey } from '../../i18n/localization'
import type { CreateLiveActivityResult, LiveSession } from '../liveSharing/useLiveActivitySession'
import { buildLiveActivityUrl } from '../liveSharing/liveActivityLink'
import { exportActivitySummary, type ShareResult } from './shareActivity'
import { copyLink, shareLink, type LinkShareResult } from './shareLink'
import { createSharedActivity, type SharedActivity } from './sharedActivity'

export type ActivityFeedback = { groupId: string; message: string } | null
export type QrShare = {
  groupName: string
  url: string
  activityCode?: string
}

type ActivitySharingOptions = {
  analyticsClient: AnalyticsClient | null
  createLiveActivity: (activity: SharedActivity, groupId: string) => Promise<CreateLiveActivityResult>
  locale: AppLocale
  notifyLive: (message: string) => void
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

export function useActivitySharing({
  analyticsClient,
  createLiveActivity,
  locale,
  notifyLive,
  setActivityFeedback,
  t,
}: ActivitySharingOptions) {
  const [qrShare, setQrShare] = useState<QrShare | null>(null)

  const shareGroup = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const result = await exportActivitySummary(group, members, expenses, locale)
    setActivityFeedback({ groupId: group.id, message: t(SUMMARY_MESSAGE_KEYS[result]) })
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
    setActivityFeedback(null)
    analyticsClient?.track('live_activity_created', 'local', locale)
    setQrShare({ groupName: group.name, url: result.url, activityCode: result.code })
  }

  const openCurrentLiveQr = (session: LiveSession) => {
    setQrShare({
      groupName: session.record.snapshot.group.name,
      url: buildLiveActivityUrl(session.credentials),
      activityCode: session.record.code,
    })
  }

  const copyCurrentLiveLink = async (session: LiveSession) => {
    const result = await copyLink(buildLiveActivityUrl(session.credentials))
    notifyLive(t(result === 'copied' ? 'feedback.liveCopied' : 'feedback.liveCopyFailed'))
  }

  const reportQrShareResult = (share: QrShare, result: LinkShareResult) => {
    notifyLive(t(LIVE_QR_MESSAGE_KEYS[result]))
    if (result === 'shared' || result === 'copied') setQrShare(null)
  }

  const shareQrLink = async (share: QrShare) => {
    const result = await shareLink(
      t('share.linkTitle', { name: share.groupName }),
      share.url,
      t('share.liveLinkText', { name: share.groupName }),
    )
    reportQrShareResult(share, result)
  }

  const copyQrLink = async (share: QrShare) => {
    const result = await copyLink(share.url)
    if (result === 'failed') {
      notifyLive(t('feedback.liveCopyFailed'))
      return
    }
    reportQrShareResult(share, result)
  }

  return {
    closeQrShare: () => setQrShare(null),
    copyCurrentLiveLink,
    copyQrLink,
    openCurrentLiveQr,
    openLiveShare,
    qrShare,
    shareGroup,
    shareQrLink,
  }
}
