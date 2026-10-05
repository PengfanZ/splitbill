import { useLocalization } from '../i18n/LocalizationContext'

/** Marks an entry point for a feature that may still change. */
export function ExperimentalTag() {
  const { t } = useLocalization()
  return <span className="experimental-tag">{t('common.experimental')}</span>
}
