import { describe, expect, it } from 'vitest'
import { INSTALL_PROMPT_STORAGE_KEY, isInstallPromptPending, markInstallPromptDone, markInstallPromptPending } from './installPromptState'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

const brokenStorage = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('blocked') },
}

describe('install prompt state', () => {
  it('becomes pending at the first activity and stays done after closing', () => {
    const storage = memoryStorage()
    expect(isInstallPromptPending(storage)).toBe(false)
    expect(markInstallPromptPending(storage)).toBe(true)
    expect(storage.getItem(INSTALL_PROMPT_STORAGE_KEY)).toBe('pending')

    markInstallPromptDone(storage)
    expect(isInstallPromptPending(storage)).toBe(false)
    expect(markInstallPromptPending(storage)).toBe(false)
    expect(storage.getItem(INSTALL_PROMPT_STORAGE_KEY)).toBe('done')
  })

  it('uses browser storage by default', () => {
    localStorage.removeItem(INSTALL_PROMPT_STORAGE_KEY)
    expect(markInstallPromptPending()).toBe(true)
    expect(isInstallPromptPending()).toBe(true)
    markInstallPromptDone()
    expect(localStorage.getItem(INSTALL_PROMPT_STORAGE_KEY)).toBe('done')
  })

  it('never shows the prompt when storage is blocked, since it could not be dismissed for good', () => {
    expect(isInstallPromptPending(brokenStorage)).toBe(false)
    expect(markInstallPromptPending(brokenStorage)).toBe(false)
    expect(() => markInstallPromptDone(brokenStorage)).not.toThrow()
  })
})
