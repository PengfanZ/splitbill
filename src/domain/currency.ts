import type { ActivityGroup } from './models'
import { SUPPORTED_CURRENCIES, type CurrencyCode } from './currencyCodes'

export { SUPPORTED_CURRENCIES, type CurrencyCode } from './currencyCodes'

export const DEFAULT_CURRENCY: CurrencyCode = 'USD'

const SIMPLIFIED_CHINESE_CURRENCY_NAMES: Record<CurrencyCode, string> = {
  USD: '美元',
  EUR: '欧元',
  GBP: '英镑',
  CNY: '人民币',
  JPY: '日元',
  CAD: '加拿大元',
  AUD: '澳大利亚元',
  HKD: '港元',
  SGD: '新加坡元',
  KRW: '韩元',
  INR: '印度卢比',
  CHF: '瑞士法郎',
  NZD: '新西兰元',
  TWD: '新台币',
  THB: '泰铢',
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && SUPPORTED_CURRENCIES.some(currency => currency === value)
}

export function defaultCurrencyForLocale(locale: string): CurrencyCode {
  return locale === 'zh-CN' ? 'CNY' : DEFAULT_CURRENCY
}

export function currencyLabel(currency: CurrencyCode, locale: string) {
  return locale === 'zh-CN' ? SIMPLIFIED_CHINESE_CURRENCY_NAMES[currency] : currency
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
