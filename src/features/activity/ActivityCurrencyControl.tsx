import { CircleDollarSign } from 'lucide-react'
import { SelectMenu, type SelectMenuOption } from '../../components/SelectMenu'
import { currencyLabel, currencySymbol, SUPPORTED_CURRENCIES, type CurrencyCode } from '../../domain/currency'
import { useLocalization } from '../../i18n/LocalizationContext'

export function ActivityCurrencyControl({ currency, locale, readOnly, onChange }: {
  currency: CurrencyCode
  locale: string
  readOnly: boolean
  onChange?: (currency: CurrencyCode) => void
}) {
  const { t } = useLocalization()
  const localizedLabels = locale === 'zh-CN'
  const selectedLabel = currencyLabel(currency, locale)
  const value = `${selectedLabel} · ${currencySymbol(currency, locale)}`

  if (!onChange || readOnly) {
    return (
      <div className={`activity-currency activity-currency--read-only${localizedLabels ? ' activity-currency--localized' : ''}`}>
        <span className="activity-currency-icon"><CircleDollarSign size={18} /></span>
        <b>{value}</b>
      </div>
    )
  }

  const options: ReadonlyArray<SelectMenuOption<CurrencyCode>> = SUPPORTED_CURRENCIES.map(code => ({
    value: code,
    label: currencyLabel(code, locale),
    detail: code,
    leading: currencySymbol(code, locale),
    searchText: `${currencyLabel(code, locale)} ${code}`,
  }))

  return (
    <SelectMenu
      value={currency}
      options={options}
      onChange={onChange}
      ariaLabel={t('group.chooseCurrency', { currency: selectedLabel })}
      menuLabel={t('group.currencyMenu')}
      title={t('group.currency')}
      description={t('group.currencyHelp')}
      variant="compact"
      align="end"
      className={`activity-currency${localizedLabels ? ' activity-currency--localized' : ''}`}
      renderValue={() => (
        <>
          <span className="activity-currency-icon"><CircleDollarSign size={18} /></span>
          <b>{value}</b>
        </>
      )}
    />
  )
}
