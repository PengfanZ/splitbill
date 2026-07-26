import type { AppLocale, TranslationKey } from '../../i18n/localization'

export const CHANGELOG_SEEN_STORAGE_KEY = 'tally:changelog-seen:v1'

export type ChangelogIcon = 'live' | 'share' | 'settle' | 'polish'

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
