import { CURRENT_USER, initialsFor } from '../domain/members'
import type { Member } from '../domain/models'
import { loadBrowserStorageValue, saveBrowserStorageValue } from './browserStorage'

export const IDENTITY_KEY = 'tally:identity:v1'

export function createIdentity(name: string): Member {
  const trimmed = name.trim()
  if (!trimmed) throw new RangeError('Identity name is required')
  return {
    ...CURRENT_USER,
    name: trimmed,
    initials: initialsFor(trimmed),
  }
}

export function parseIdentity(stored: string | null): Member | null {
  try {
    if (!stored) return null
    const value: unknown = JSON.parse(stored)
    if (
      typeof value !== 'object'
      || value === null
      || !('id' in value) || value.id !== 'me'
      || !('name' in value) || typeof value.name !== 'string' || !value.name.trim()
      || !('initials' in value) || typeof value.initials !== 'string'
      || !('color' in value) || typeof value.color !== 'string'
    ) return null
    return value as Member
  } catch {
    return null
  }
}

export function loadIdentity() {
  return loadBrowserStorageValue(IDENTITY_KEY, parseIdentity, null)
}

export function saveIdentity(identity: Member) {
  saveBrowserStorageValue(IDENTITY_KEY, identity)
}
