import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserInstallGuide, captureInstallPrompt, openNativeInstallPrompt, useInstallGuide } from './installGuide'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const MAC_SAFARI_18 = IPAD_DESKTOP_MODE
const MAC_SAFARI_16 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15'
const MAC_SAFARI_NO_VERSION = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0'
const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
const WECHAT_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.53(0x18003531) NetType/WIFI Language/zh_CN'
const INSTAGRAM_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 358.0.0.0'

function setBrowser(userAgent: string, maxTouchPoints = 0) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints })
}

function installEvent(outcome: 'accepted' | 'dismissed') {
  return Object.assign(new Event('beforeinstallprompt'), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  })
}

beforeAll(() => captureInstallPrompt())

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ matches: false }) })
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: false })
  setBrowser(WINDOWS_EDGE)
})

afterEach(() => {
  act(() => {
    window.dispatchEvent(new Event('appinstalled'))
  })
})

describe('browserInstallGuide', () => {
  it.each([
    ['Safari on iPhone', IPHONE_SAFARI, 0, 'ios'],
    ['Chrome on iPhone', IPHONE_CHROME, 0, 'ios'],
    ['an iPad asking for desktop sites', IPAD_DESKTOP_MODE, 5, 'ios'],
    ['Safari 17+ on a Mac', MAC_SAFARI_18, 0, 'mac-safari'],
    ['WeChat', WECHAT_IOS, 0, 'in-app'],
    ['Instagram', INSTAGRAM_ANDROID, 0, 'in-app'],
  ])('guides %s', (_, userAgent, maxTouchPoints, guide) => {
    expect(browserInstallGuide({ userAgent, maxTouchPoints })).toBe(guide)
  })

  it.each([
    ['Safari 16 on a Mac, which has no Add to Dock', MAC_SAFARI_16],
    ['Mac Safari without a version', MAC_SAFARI_NO_VERSION],
    ['Chrome on a Mac, which uses its own prompt', MAC_CHROME],
    ['Firefox, which cannot install', MAC_FIREFOX],
    ['Edge on Windows, which uses its own prompt', WINDOWS_EDGE],
  ])('stays quiet for %s', (_, userAgent) => {
    expect(browserInstallGuide({ userAgent, maxTouchPoints: 0 })).toBeNull()
  })
})

describe('useInstallGuide', () => {
  it('offers the native prompt once Chromium fires it, and forgets it after installing', () => {
    const { result } = renderHook(() => useInstallGuide())
    expect(result.current).toBeNull()

    act(() => {
      window.dispatchEvent(installEvent('accepted'))
    })
    expect(result.current).toBe('native')

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })
    expect(result.current).toBeNull()
  })

  it('prefers the open-in-browser guide inside an in-app browser', () => {
    setBrowser(INSTAGRAM_ANDROID)
    act(() => {
      window.dispatchEvent(installEvent('accepted'))
    })
    const { result } = renderHook(() => useInstallGuide())
    expect(result.current).toBe('in-app')
  })

  it('returns the manual guide where there is no native prompt', () => {
    setBrowser(IPHONE_SAFARI)
    const { result } = renderHook(() => useInstallGuide())
    expect(result.current).toBe('ios')
  })

  it('shows nothing once Tally runs as an installed app', () => {
    setBrowser(IPHONE_SAFARI)
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    const { result } = renderHook(() => useInstallGuide())
    expect(result.current).toBeNull()
  })
})

describe('openNativeInstallPrompt', () => {
  it('opens the browser dialog once and reports the choice', async () => {
    const event = installEvent('accepted')
    window.dispatchEvent(event)

    await expect(openNativeInstallPrompt()).resolves.toBe('accepted')
    expect(event.prompt).toHaveBeenCalledOnce()
    await expect(openNativeInstallPrompt()).resolves.toBe('dismissed')
  })

  it('reports a closed dialog as dismissed', async () => {
    window.dispatchEvent(installEvent('dismissed'))
    await expect(openNativeInstallPrompt()).resolves.toBe('dismissed')
  })
})
