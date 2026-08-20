import { Monitor, Moon, Sun } from 'lucide-react'
import { useLocalization } from '../../i18n/LocalizationContext'
import { useTheme } from '../../theme/ThemeContext'
import type { ThemePreference } from '../../theme/theme'

const THEME_OPTIONS = [
  { value: 'system', labelKey: 'settings.themeSystem', icon: Monitor },
  { value: 'light', labelKey: 'settings.themeLight', icon: Sun },
  { value: 'dark', labelKey: 'settings.themeDark', icon: Moon },
] as const satisfies ReadonlyArray<{
  value: ThemePreference
  labelKey: 'settings.themeSystem' | 'settings.themeLight' | 'settings.themeDark'
  icon: typeof Monitor
}>

export function ThemeControl() {
  const { preference, setPreference } = useTheme()
  const { t } = useLocalization()

  return (
    <fieldset className="theme-field">
      <legend>{t('settings.appearance')}</legend>
      <div className="theme-options" role="radiogroup" aria-label={t('settings.chooseTheme')}>
        {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
          <label className={preference === value ? 'is-selected' : undefined} key={value}>
            <input
              type="radio"
              name="theme-preference"
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
            />
            <Icon aria-hidden="true" size={16} />
            <span>{t(labelKey)}</span>
          </label>
        ))}
      </div>
      <small>{t('settings.themeSystemHelp')}</small>
    </fieldset>
  )
}
