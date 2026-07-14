import { useEffect, useState } from 'react'
import { isLiveActivityCredentials, type LiveActivityCredentials } from './liveActivityLink'

export const LIVE_ACTIVITY_BOOKMARKS_KEY = 'tally:live-activity-bookmarks:v1'

export type LiveActivityBookmarks = Record<string, LiveActivityCredentials>

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
  try {
    return parseLiveActivityBookmarks(localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY))
  } catch {
    return {}
  }
}

export function saveLiveActivityBookmarks(bookmarks: LiveActivityBookmarks) {
  try {
    const serialized = JSON.stringify(bookmarks)
    if (localStorage.getItem(LIVE_ACTIVITY_BOOKMARKS_KEY) !== serialized) localStorage.setItem(LIVE_ACTIVITY_BOOKMARKS_KEY, serialized)
  } catch {
    // Keep live activities usable when browser storage is unavailable.
  }
}

export function useLiveActivityBookmarks() {
  const [bookmarks, setBookmarks] = useState<LiveActivityBookmarks>(() => loadLiveActivityBookmarks())

  useEffect(() => saveLiveActivityBookmarks(bookmarks), [bookmarks])
  useEffect(() => {
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === LIVE_ACTIVITY_BOOKMARKS_KEY) setBookmarks(parseLiveActivityBookmarks(event.newValue))
    }
    window.addEventListener('storage', syncAcrossTabs)
    return () => window.removeEventListener('storage', syncAcrossTabs)
  }, [])

  return [bookmarks, setBookmarks] as const
}
