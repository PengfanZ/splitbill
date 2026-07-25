import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { useLocalization } from '../../i18n/LocalizationContext'
import type { AppLocale, TranslationKey } from '../../i18n/localization'

const LANGUAGE_OPTIONS: ReadonlyArray<{
  locale: AppLocale
  labelKey: TranslationKey
  mark: string
}> = [
  { locale: 'en', labelKey: 'settings.english', mark: 'EN' },
  { locale: 'zh-CN', labelKey: 'settings.chinese', mark: '中' },
]

export function LanguageControl({ locale, onChange }: {
  locale: AppLocale
  onChange: (locale: AppLocale) => void
}) {
  const { t } = useLocalization()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selectedOption = LANGUAGE_OPTIONS.find(option => option.locale === locale)!
  const selectedLabel = t(selectedOption.labelKey)

  useEffect(() => {
    if (!open) return
    const root = rootRef.current!
    const closeOutside = (event: PointerEvent) => {
      if (!event.composedPath().includes(root)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const selectLanguage = (nextLocale: AppLocale) => {
    onChange(nextLocale)
    setOpen(false)
    triggerRef.current!.focus()
  }

  return (
    <div ref={rootRef} className="language-picker" onKeyDown={event => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current!.focus()
    }}>
      <button
        ref={triggerRef}
        type="button"
        className="language-trigger"
        aria-label={t('settings.chooseLanguage', { language: selectedLabel })}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span className="language-trigger-icon"><Languages size={18} /></span>
        <span className="language-trigger-copy"><b>{selectedLabel}</b><small>{selectedOption.locale}</small></span>
        <ChevronDown className={open ? 'language-chevron language-chevron--open' : 'language-chevron'} size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="language-menu" role="listbox" aria-label={t('settings.languageMenu')}>
          {LANGUAGE_OPTIONS.map(option => {
            const selected = option.locale === locale
            return (
              <button
                type="button"
                role="option"
                aria-label={t(option.labelKey)}
                aria-selected={selected}
                className={selected ? 'language-option language-option--selected' : 'language-option'}
                key={option.locale}
                onClick={() => selectLanguage(option.locale)}
              >
                <span>{option.mark}</span>
                <b>{t(option.labelKey)}</b>
                {selected ? <Check size={17} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
