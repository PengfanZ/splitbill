import { parseLiveActivityHash } from '../liveSharing/liveActivityLink'
import { decodeSharedActivityHash } from './shareActivityUrl'

type NavigatorWithStandalone = Navigator & { standalone?: boolean }

export function extractSharedActivityHash(input: string, currentUrl = window.location.href) {
  try {
    const url = new URL(input.trim(), currentUrl)
    return parseLiveActivityHash(url.hash) || decodeSharedActivityHash(url.hash) ? url.hash : null
  } catch {
    return null
  }
}

export function isStandalonePwa() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as NavigatorWithStandalone).standalone === true
}
