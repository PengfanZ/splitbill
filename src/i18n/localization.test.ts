import { describe, expect, it, vi } from 'vitest'
import {
  LOCALE_STORAGE_KEY,
  formatLocalizedDateTime,
  formatLocalizedDay,
  localDayKey,
  formatLocalizedList,
  getLocalTimeZone,
  loadLocale,
  normalizeLocale,
  resolveLocale,
  saveLocale,
  translate,
} from './localization'

function storageWith(value: string | null = null): Storage {
  return {
    length: value === null ? 0 : 1,
    clear: vi.fn(),
    getItem: vi.fn(() => value),
    key: vi.fn(() => value === null ? null : LOCALE_STORAGE_KEY),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  }
}

describe('localization', () => {
  it.each([
    [undefined, null],
    [null, null],
    ['', null],
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hans-SG', 'zh-CN'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['fr-FR', null],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected)
  })

  it('prefers an explicit saved language, then China signals, then supported browser languages', () => {
    expect(resolveLocale('en', ['zh-CN'], 'Asia/Shanghai')).toBe('en')
    expect(resolveLocale('zh-CN', ['en-US'], 'America/New_York')).toBe('zh-CN')
    expect(resolveLocale(null, ['en-US'], 'Asia/Shanghai')).toBe('zh-CN')
    expect(resolveLocale(null, ['en-US'], 'Asia/Urumqi')).toBe('zh-CN')
    expect(resolveLocale(null, ['en-US'], 'Asia/Chongqing')).toBe('zh-CN')
    expect(resolveLocale(null, ['en-US'], 'Asia/Harbin')).toBe('zh-CN')
    expect(resolveLocale(null, ['en-US'], 'Asia/Kashgar')).toBe('zh-CN')
    expect(resolveLocale(null, ['fr-FR', 'zh-Hans'], 'Europe/Paris')).toBe('zh-CN')
    expect(resolveLocale(null, ['fr-FR', 'en-GB'], 'Europe/Paris')).toBe('en')
    expect(resolveLocale(null, ['fr-FR'], 'Europe/Paris')).toBe('en')
  })

  it('loads and saves locale defensively', () => {
    const storedChinese = storageWith('zh-CN')
    expect(loadLocale(storedChinese, ['en-US'], 'America/New_York')).toBe('zh-CN')

    const empty = storageWith()
    expect(loadLocale(empty, ['en-US'], 'Asia/Shanghai')).toBe('zh-CN')
    saveLocale('en', empty)
    expect(empty.setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'en')

    const blocked = storageWith()
    vi.mocked(blocked.getItem).mockImplementation(() => { throw new Error('blocked') })
    vi.mocked(blocked.setItem).mockImplementation(() => { throw new Error('blocked') })
    expect(loadLocale(blocked, ['zh-CN'], 'UTC')).toBe('zh-CN')
    expect(() => saveLocale('zh-CN', blocked)).not.toThrow()
  })

  it('translates variables, lists, and valid dates for the selected locale and time zone', () => {
    expect(translate('en', 'dashboard.memberBalance', { name: 'Maya' })).toBe('Maya balance')
    expect(translate('zh-CN', 'dashboard.memberBalance', { name: '小明' })).toBe('小明 的余额')
    expect(formatLocalizedList(['Maya', 'Jordan'], 'en')).toContain('Maya')
    expect(formatLocalizedList(['小明', '小红'], 'zh-CN')).toBe('小明和小红')

    const utc = formatLocalizedDateTime('2026-07-16T12:30:00.000Z', 'en', 'UTC')
    const shanghai = formatLocalizedDateTime('2026-07-16T12:30:00.000Z', 'zh-CN', 'Asia/Shanghai')
    expect(utc).toMatch(/Jul 16, 2026.*12:30.*UTC/)
    expect(shanghai).toMatch(/2026.*7.*16/)
    expect(shanghai).toContain('20:30')
    expect(shanghai).toContain('GMT+8')
    expect(formatLocalizedDateTime('not-a-date', 'en', 'UTC')).toBeNull()
  })

  it('reports the browser IANA time zone with a UTC fallback', () => {
    expect(getLocalTimeZone()).toBeTruthy()
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: '' }),
    } as Intl.DateTimeFormat)
    expect(getLocalTimeZone()).toBe('UTC')
    formatter.mockRestore()
  })

  it('groups timestamps by local calendar day and labels days with the year only when needed', () => {
    expect(localDayKey('2026-09-22T23:30:00.000Z', 'UTC')).toBe('2026-09-22')
    expect(localDayKey('2026-09-22T23:30:00.000Z', 'Asia/Shanghai')).toBe('2026-09-23')
    expect(localDayKey('Just now', 'UTC')).toBeNull()
    const now = new Date('2026-09-25T12:00:00.000Z')
    expect(formatLocalizedDay('2026-09-22T12:00:00.000Z', 'en', 'UTC', now)).toBe('Tue, Sep 22')
    expect(formatLocalizedDay('2025-12-31T12:00:00.000Z', 'en', 'UTC', now)).toBe('Wed, Dec 31, 2025')
    expect(formatLocalizedDay('2026-09-22T12:00:00.000Z', 'zh-CN', 'Asia/Shanghai', now)).toBe('9月22日周二')
    expect(formatLocalizedDay('2026-09-22T12:00:00.000Z', 'en', 'UTC')).toMatch(/Sep 22/)
  })
})
