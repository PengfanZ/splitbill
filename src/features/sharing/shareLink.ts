export type LinkShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export async function copyLink(url: string): Promise<'copied' | 'failed'> {
  if (typeof navigator.clipboard?.writeText !== 'function') return 'failed'
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export async function shareLink(title: string, url: string, text?: string): Promise<LinkShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  return copyLink(url)
}
