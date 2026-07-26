import { describe, expect, it } from 'vitest'
import {
  activityCurrency,
  currencyLabel,
  currencySymbol,
  currencySymbolFromParts,
  defaultCurrencyForLocale,
  formatMoney,
  isCurrencyCode,
  SUPPORTED_CURRENCIES,
} from './currency'

describe('activity currency', () => {
  it('recognizes supported codes and falls back safely for old activities', () => {
    expect(SUPPORTED_CURRENCIES).toContain('CNY')
    expect(isCurrencyCode('EUR')).toBe(true)
    expect(isCurrencyCode('BTC')).toBe(false)
    expect(isCurrencyCode(null)).toBe(false)
    expect(activityCurrency({ currency: 'CNY' })).toBe('CNY')
    expect(activityCurrency({})).toBe('USD')
    expect(activityCurrency({ currency: 'BTC' as 'USD' })).toBe('USD')
  })

  it('uses CNY for Simplified Chinese and USD for other locales', () => {
    expect(defaultCurrencyForLocale('zh-CN')).toBe('CNY')
    expect(defaultCurrencyForLocale('en')).toBe('USD')
  })

  it('shows natural Chinese currency names while keeping English codes unchanged', () => {
    expect(SUPPORTED_CURRENCIES.map(currency => currencyLabel(currency, 'zh-CN'))).toEqual([
      '美元',
      '欧元',
      '英镑',
      '人民币',
      '日元',
      '加拿大元',
      '澳大利亚元',
      '港元',
      '新加坡元',
      '韩元',
      '印度卢比',
      '瑞士法郎',
      '新西兰元',
      '新台币',
      '泰铢',
    ])
    expect(currencyLabel('CNY', 'en')).toBe('CNY')
    expect(currencyLabel('USD', 'en-US')).toBe('USD')
  })

  it('formats absolute amounts and exposes the localized narrow symbol', () => {
    expect(formatMoney(-12.5, 'EUR', 'en-US')).toBe('€12.50')
    expect(currencySymbol('CNY', 'en-US')).toBe('¥')
  })

  it('falls back to the currency code when the formatter omits a currency part', () => {
    expect(currencySymbolFromParts([{ type: 'integer', value: '0' }], 'CHF')).toBe('CHF')
  })
})
