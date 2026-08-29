import { parseLiveActivityHash } from '../liveSharing/liveActivityLink'

export function extractLiveActivityHash(input: string, currentUrl = window.location.href) {
  try {
    const url = new URL(input.trim(), currentUrl)
    return parseLiveActivityHash(url.hash) ? url.hash : null
  } catch {
    return null
  }
}
