import { Languages } from 'lucide-react'
import { SelectMenu, type SelectMenuOption } from '../../components/SelectMenu'
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
  const selectedOption = LANGUAGE_OPTIONS.find(option => option.locale === locale)!
  const selectedLabel = t(selectedOption.labelKey)
  const options: ReadonlyArray<SelectMenuOption<AppLocale>> = LANGUAGE_OPTIONS.map(option => ({
    value: option.locale,
    label: t(option.labelKey),
    detail: option.locale,
    leading: option.mark,
  }))

  return (
    <SelectMenu
      value={locale}
      options={options}
      onChange={onChange}
      ariaLabel={t('settings.chooseLanguage', { language: selectedLabel })}
      menuLabel={t('settings.languageMenu')}
      className="language-trigger"
      renderValue={() => (
        <>
          <span className="language-trigger-icon"><Languages size={18} /></span>
          <span className="language-trigger-copy"><b>{selectedLabel}</b><small>{selectedOption.locale}</small></span>
        </>
      )}
    />
  )
}
