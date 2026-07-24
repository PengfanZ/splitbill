import type { ActivityGroup } from './models'

export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CNY',
  'JPY',
  'CAD',
  'AUD',
  'HKD',
  'SGD',
  'KRW',
  'INR',
  'CHF',
  'NZD',
  'TWD',
  'THB',
] as const

export type CurrencyCode = typeof SUPPORTED_CURRENCIES[number]

export const DEFAULT_CURRENCY: CurrencyCode = 'USD'

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && SUPPORTED_CURRENCIES.some(currency => currency === value)
}

export function defaultCurrencyForLocale(locale: string): CurrencyCode {
  return locale === 'zh-CN' ? 'CNY' : DEFAULT_CURRENCY
}

export function activityCurrency(group: Pick<ActivityGroup, 'currency'>): CurrencyCode {
  return isCurrencyCode(group.currency) ? group.currency : DEFAULT_CURRENCY
}

export function currencySymbol(currency: CurrencyCode, locale = 'en-US') {
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(0)
  return currencySymbolFromParts(parts, currency)
}

export function currencySymbolFromParts(parts: Intl.NumberFormatPart[], currency: CurrencyCode) {
  return parts.find(part => part.type === 'currency')?.value ?? currency
}

export function formatMoney(value: number, currency: CurrencyCode = DEFAULT_CURRENCY, locale = 'en-US') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value))
}
