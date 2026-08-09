import type { AppLocale, TranslationKey } from '../../i18n/localization'

export const CHANGELOG_SEEN_STORAGE_KEY = 'tally:changelog-seen:v1'

export type ChangelogIcon = 'aiText' | 'aiVoice' | 'aiReview' | 'live' | 'share' | 'settle' | 'polish'

export type ChangelogEntry = {
  id: string
  releasedOn: string
  titleKey: TranslationKey
  summaryKey: TranslationKey
  items: Array<{
    icon: ChangelogIcon
    titleKey: TranslationKey
    descriptionKey: TranslationKey
  }>
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    id: '2026-08-live-controls',
    releasedOn: '2026-08-08',
    titleKey: 'changelog.release.liveControlsTitle',
    summaryKey: 'changelog.release.liveControlsSummary',
    items: [
      {
        icon: 'live',
        titleKey: 'changelog.item.endLiveTitle',
        descriptionKey: 'changelog.item.endLiveDescription',
      },
      {
        icon: 'polish',
        titleKey: 'changelog.item.saferSharingTitle',
        descriptionKey: 'changelog.item.saferSharingDescription',
      },
    ],
  },
  {
    id: '2026-08-ai-entry',
    releasedOn: '2026-08-02',
    titleKey: 'changelog.release.aiTitle',
    summaryKey: 'changelog.release.aiSummary',
    items: [
      {
        icon: 'aiText',
        titleKey: 'changelog.item.aiTextTitle',
        descriptionKey: 'changelog.item.aiTextDescription',
      },
      {
        icon: 'aiVoice',
        titleKey: 'changelog.item.aiVoiceTitle',
        descriptionKey: 'changelog.item.aiVoiceDescription',
      },
      {
        icon: 'aiReview',
        titleKey: 'changelog.item.aiReviewTitle',
        descriptionKey: 'changelog.item.aiReviewDescription',
      },
    ],
  },
  {
    id: '2026-07-live-sharing',
    releasedOn: '2026-07-26',
    titleKey: 'changelog.release.liveTitle',
    summaryKey: 'changelog.release.liveSummary',
    items: [
      {
        icon: 'live',
        titleKey: 'changelog.item.liveTitle',
        descriptionKey: 'changelog.item.liveDescription',
      },
      {
        icon: 'share',
        titleKey: 'changelog.item.shareTitle',
        descriptionKey: 'changelog.item.shareDescription',
      },
      {
        icon: 'settle',
        titleKey: 'changelog.item.settleTitle',
        descriptionKey: 'changelog.item.settleDescription',
      },
      {
        icon: 'polish',
        titleKey: 'changelog.item.polishTitle',
        descriptionKey: 'changelog.item.polishDescription',
      },
    ],
  },
]

export const LATEST_CHANGELOG_ID = CHANGELOG_ENTRIES[0].id

export function hasSeenLatestChangelog(storage: Storage = localStorage) {
  try {
    return storage.getItem(CHANGELOG_SEEN_STORAGE_KEY) === LATEST_CHANGELOG_ID
  } catch {
    return false
  }
}

export function markLatestChangelogSeen(storage: Storage = localStorage) {
  try {
    storage.setItem(CHANGELOG_SEEN_STORAGE_KEY, LATEST_CHANGELOG_ID)
  } catch {
    // Changelog access should never prevent the app from working.
  }
}

export function formatChangelogDate(value: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`))
}
