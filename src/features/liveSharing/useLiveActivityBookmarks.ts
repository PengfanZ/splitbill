import { loadBrowserStorageValue, saveBrowserStorageValue } from '../../data/browserStorage'
import { usePersistentStorageState } from '../../hooks/usePersistentStorageState'
import { isLiveActivityCredentials, type LiveActivityCredentials } from './liveActivityLink'

export const LIVE_ACTIVITY_BOOKMARKS_KEY = 'tally:live-activity-bookmarks:v1'

export type LiveActivityBookmarks = Record<string, LiveActivityCredentials>

export function findLiveActivityBookmarkGroupId(bookmarks: LiveActivityBookmarks, credentials: LiveActivityCredentials) {
  return Object.entries(bookmarks).find(([, saved]) => saved.code === credentials.code && saved.editToken === credentials.editToken)?.[0] ?? null
}

export function liveActivityShortcutId(code: string) {
  return `live-${code.toLowerCase()}`
}

export function parseLiveActivityBookmarks(stored: string | null): LiveActivityBookmarks {
  try {
    if (!stored) return {}
    const parsed = JSON.parse(stored) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([groupId, credentials]) => groupId.length > 0 && isLiveActivityCredentials(credentials)))
  } catch {
    return {}
  }
}

export function loadLiveActivityBookmarks(): LiveActivityBookmarks {
  return loadBrowserStorageValue(LIVE_ACTIVITY_BOOKMARKS_KEY, parseLiveActivityBookmarks, {})
}

export function saveLiveActivityBookmarks(bookmarks: LiveActivityBookmarks) {
  saveBrowserStorageValue(LIVE_ACTIVITY_BOOKMARKS_KEY, bookmarks)
}

export function useLiveActivityBookmarks() {
  return usePersistentStorageState({
    key: LIVE_ACTIVITY_BOOKMARKS_KEY,
    load: loadLiveActivityBookmarks,
    parse: parseLiveActivityBookmarks,
    save: saveLiveActivityBookmarks,
  })
}
