export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const
export type AppLocale = typeof SUPPORTED_LOCALES[number]
