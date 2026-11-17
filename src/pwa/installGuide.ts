import { useSyncExternalStore } from 'react'
import { isStandalonePwa } from './displayMode'

/**
 * How this browser installs Tally:
 * - `native`: Chromium fired `beforeinstallprompt`, so Tally can open the browser's own install dialog.
 * - `ios`: iPhone or iPad. Share → Add to Home Screen; sites cannot start it themselves.
 * - `mac-safari`: Safari 17+ on a Mac. File → Add to Dock.
 * - `in-app`: an app's built-in browser (WeChat, Instagram…), which cannot install. Open the page in a real browser first.
 */
export type InstallGuide = 'native' | 'ios' | 'mac-safari' | 'in-app'

type BrowserSignals = Pick<Navigator, 'userAgent' | 'maxTouchPoints'>

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const IN_APP_BROWSER = /MicroMessenger|Instagram|FBAN|FBAV|Line\/|Weibo/i
const NON_SAFARI_MAC_BROWSER = /Chrome|Chromium|Edg|Firefox|OPR/

/** The manual install path for browsers without a native prompt, or null where installing isn't possible. */
export function browserInstallGuide({ userAgent, maxTouchPoints }: BrowserSignals): Exclude<InstallGuide, 'native'> | null {
  if (IN_APP_BROWSER.test(userAgent)) return 'in-app'
  // iPadOS reports a Mac user agent; touch support tells them apart.
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios'
  if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent) && !NON_SAFARI_MAC_BROWSER.test(userAgent)) {
    const version = Number(/Version\/(\d+)/.exec(userAgent)?.[1] ?? 0)
    return version >= 17 ? 'mac-safari' : null
  }
  return null
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function setDeferredPrompt(event: BeforeInstallPromptEvent | null) {
  deferredPrompt = event
  listeners.forEach(listener => listener())
}

/**
 * Keeps Chromium's install event so Tally can offer it later. Call before rendering: the event can fire early.
 * The browser's own install UI is left alone (no preventDefault).
 */
export function captureInstallPrompt(target: Window = window) {
  target.addEventListener('beforeinstallprompt', event => setDeferredPrompt(event as BeforeInstallPromptEvent))
  target.addEventListener('appinstalled', () => setDeferredPrompt(null))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getDeferredPrompt = () => deferredPrompt

/** Opens the browser's install dialog. Each captured event can be used once. */
export async function openNativeInstallPrompt(): Promise<'accepted' | 'dismissed'> {
  const event = deferredPrompt
  if (!event) return 'dismissed'
  setDeferredPrompt(null)
  await event.prompt()
  return (await event.userChoice).outcome
}

export function useInstallGuide(): InstallGuide | null {
  const nativePrompt = useSyncExternalStore(subscribe, getDeferredPrompt)
  if (isStandalonePwa()) return null
  const guide = browserInstallGuide(navigator)
  if (guide === 'in-app') return guide
  return nativePrompt ? 'native' : guide
}
