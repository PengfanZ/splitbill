export const LIVE_ACTIVITY_HASH_PREFIX = '#live='
export const LIVE_ACTIVITY_CODE_PATTERN = /^[A-F0-9]{10}$/
export const LIVE_ACTIVITY_TOKEN_PATTERN = /^[a-f0-9]{64}$/

export type LiveActivityCredentials = {
  code: string
  editToken: string
}

export function isLiveActivityCredentials(value: unknown): value is LiveActivityCredentials {
  if (typeof value !== 'object' || value === null) return false
  const credentials = value as Record<string, unknown>
  return typeof credentials.code === 'string'
    && LIVE_ACTIVITY_CODE_PATTERN.test(credentials.code)
    && typeof credentials.editToken === 'string'
    && LIVE_ACTIVITY_TOKEN_PATTERN.test(credentials.editToken)
}

export function buildLiveActivityUrl(credentials: LiveActivityCredentials, currentUrl = window.location.href) {
  if (!isLiveActivityCredentials(credentials)) throw new RangeError('Invalid live activity credentials')
  const url = new URL(currentUrl)
  url.hash = `${LIVE_ACTIVITY_HASH_PREFIX.slice(1)}${credentials.code}.${credentials.editToken}`
  return url.href
}

export function parseLiveActivityHash(hash: string): LiveActivityCredentials | null {
  if (!hash.startsWith(LIVE_ACTIVITY_HASH_PREFIX)) return null
  const [code, editToken, extra] = hash.slice(LIVE_ACTIVITY_HASH_PREFIX.length).split('.')
  const credentials = { code, editToken }
  return extra === undefined && isLiveActivityCredentials(credentials) ? credentials : null
}

export function clearLiveActivityHash() {
  const url = new URL(window.location.href)
  url.hash = ''
  window.history.replaceState(null, '', url)
}
