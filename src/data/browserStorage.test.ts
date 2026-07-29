import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadBrowserStorageValue, saveBrowserStorageValue } from './browserStorage'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('browser storage helpers', () => {
  it('loads through a schema parser and falls back when storage is unavailable', () => {
    localStorage.setItem('value', '{"count":2}')
    const parse = vi.fn((stored: string | null) => JSON.parse(stored ?? '{}') as { count?: number })

    expect(loadBrowserStorageValue('value', parse, {})).toEqual({ count: 2 })
    expect(parse).toHaveBeenCalledWith('{"count":2}')

    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadBrowserStorageValue('value', parse, { count: 0 })).toEqual({ count: 0 })
  })

  it('writes only changed JSON values and ignores unsupported or unavailable storage', () => {
    const setItem = vi.spyOn(localStorage, 'setItem')

    saveBrowserStorageValue('value', { count: 1 })
    expect(setItem).toHaveBeenCalledOnce()

    setItem.mockClear()
    saveBrowserStorageValue('value', { count: 1 })
    expect(setItem).not.toHaveBeenCalled()

    saveBrowserStorageValue('value', undefined)
    expect(setItem).not.toHaveBeenCalled()

    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(() => saveBrowserStorageValue('value', circular)).not.toThrow()

    setItem.mockImplementation(() => { throw new Error('blocked') })
    expect(() => saveBrowserStorageValue('value', { count: 2 })).not.toThrow()
  })
})
