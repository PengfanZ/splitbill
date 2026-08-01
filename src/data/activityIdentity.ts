import { loadBrowserStorageValue, saveBrowserStorageValue } from './browserStorage'

export const ACTIVITY_IDENTITY_KEY = 'tally:activity-identities:v1'

export type ActivityIdentitySelections = Record<string, string>

export function parseActivityIdentitySelections(stored: string | null): ActivityIdentitySelections {
  try {
    if (!stored) return {}
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([scope, memberId]) =>
      scope.length > 0 && typeof memberId === 'string' && memberId.length > 0,
    ))
  } catch {
    return {}
  }
}

export function loadActivityIdentitySelections() {
  return loadBrowserStorageValue(ACTIVITY_IDENTITY_KEY, parseActivityIdentitySelections, {})
}

export function saveActivityIdentitySelections(selections: ActivityIdentitySelections) {
  saveBrowserStorageValue(ACTIVITY_IDENTITY_KEY, selections)
}

export function selectActivityIdentity(
  selections: ActivityIdentitySelections,
  scope: string,
  memberId: string,
) {
  return { ...selections, [scope]: memberId }
}

export function removeActivityIdentity(selections: ActivityIdentitySelections, scope: string) {
  if (!(scope in selections)) return selections
  const next = { ...selections }
  delete next[scope]
  return next
}
