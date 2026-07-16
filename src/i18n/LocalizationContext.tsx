import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  formatLocalizedDateTime,
  getLocalTimeZone,
  loadLocale,
  saveLocale,
  translate,
  type AppLocale,
  type Translate,
} from './localization'

type LocalizationValue = {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  t: Translate
  timeZone: string
  formatDateTime: (value: string) => string | null
}

const fallbackLocale: AppLocale = 'en'
const fallbackTimeZone = getLocalTimeZone()
const LocalizationContext = createContext<LocalizationValue>({
  locale: fallbackLocale,
  setLocale: () => {},
  t: (key, variables) => translate(fallbackLocale, key, variables),
  timeZone: fallbackTimeZone,
  formatDateTime: value => formatLocalizedDateTime(value, fallbackLocale, fallbackTimeZone),
})

export function LocalizationProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: AppLocale }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => initialLocale ?? loadLocale())
  const timeZone = useMemo(() => getLocalTimeZone(), [])
  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale)
    saveLocale(nextLocale)
  }, [])
  const t = useCallback<Translate>((key, variables) => translate(locale, key, variables), [locale])
  const formatDateTime = useCallback((value: string) => formatLocalizedDateTime(value, locale, timeZone), [locale, timeZone])
  const value = useMemo(() => ({ locale, setLocale, t, timeZone, formatDateTime }), [formatDateTime, locale, setLocale, t, timeZone])

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('app.title')
  }, [locale, t])

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>
}

export function useLocalization() {
  return useContext(LocalizationContext)
}
