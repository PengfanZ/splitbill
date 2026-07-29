import { loadBrowserStorageValue, saveBrowserStorageValue } from '../../data/browserStorage'
import { usePersistentStorageState } from '../../hooks/usePersistentStorageState'
import { isSharedActivity } from '../sharing/shareActivityUrl'
import type { LiveActivityRecord } from './liveActivityApi'
import { LIVE_ACTIVITY_CODE_PATTERN } from './liveActivityLink'

export const LIVE_ACTIVITY_MIRRORS_KEY = 'tally:live-activity-mirrors:v1'
export const LIVE_ACTIVITY_TTL_MS = 90 * 24 * 60 * 60 * 1_000

export type LiveActivityMirror = LiveActivityRecord & {
  expiresAt: string
}

export type LiveActivityMirrors = Record<string, LiveActivityMirror>

function expiresAtFor(updatedAt: string) {
  return new Date(Date.parse(updatedAt) + LIVE_ACTIVITY_TTL_MS).toISOString()
}

export function createLiveActivityMirror(record: LiveActivityRecord): LiveActivityMirror {
  return { ...record, expiresAt: expiresAtFor(record.updatedAt) }
}

function isLiveActivityMirror(value: unknown): value is LiveActivityMirror {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const mirror = value as Partial<LiveActivityMirror>
  return typeof mirror.code === 'string'
    && LIVE_ACTIVITY_CODE_PATTERN.test(mirror.code)
    && Number.isInteger(mirror.revision)
    && (mirror.revision ?? 0) > 0
    && typeof mirror.updatedAt === 'string'
    && Number.isFinite(Date.parse(mirror.updatedAt))
    && typeof mirror.expiresAt === 'string'
    && Number.isFinite(Date.parse(mirror.expiresAt))
    && mirror.expiresAt === expiresAtFor(mirror.updatedAt)
    && isSharedActivity(mirror.snapshot)
}

export function parseLiveActivityMirrors(stored: string | null): LiveActivityMirrors {
  try {
    if (!stored) return {}
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([groupId, mirror]) => groupId.length > 0 && isLiveActivityMirror(mirror)),
    )
  } catch {
    return {}
  }
}

export function loadLiveActivityMirrors(): LiveActivityMirrors {
  return loadBrowserStorageValue(LIVE_ACTIVITY_MIRRORS_KEY, parseLiveActivityMirrors, {})
}

export function saveLiveActivityMirrors(mirrors: LiveActivityMirrors) {
  saveBrowserStorageValue(LIVE_ACTIVITY_MIRRORS_KEY, mirrors)
}

export function findLiveActivityMirrorGroupId(mirrors: LiveActivityMirrors, code: string) {
  return Object.entries(mirrors).find(([, mirror]) => mirror.code === code)?.[0] ?? null
}

export function useLiveActivityMirrors() {
  return usePersistentStorageState({
    key: LIVE_ACTIVITY_MIRRORS_KEY,
    load: loadLiveActivityMirrors,
    parse: parseLiveActivityMirrors,
    save: saveLiveActivityMirrors,
  })
}
