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
