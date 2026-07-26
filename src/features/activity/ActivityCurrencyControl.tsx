import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, CircleDollarSign } from 'lucide-react'
import { currencyLabel, currencySymbol, SUPPORTED_CURRENCIES, type CurrencyCode } from '../../domain/currency'
import { useLocalization } from '../../i18n/LocalizationContext'

export function ActivityCurrencyControl({ currency, locale, readOnly, onChange }: {
  currency: CurrencyCode
  locale: string
  readOnly: boolean
  onChange?: (currency: CurrencyCode) => void
}) {
  const { t } = useLocalization()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const localizedLabels = locale === 'zh-CN'
  const selectedLabel = currencyLabel(currency, locale)
  const value = `${selectedLabel} · ${currencySymbol(currency, locale)}`

  useEffect(() => {
    if (!open) return
    const root = rootRef.current!
    const closeOutside = (event: PointerEvent) => {
      if (!event.composedPath().includes(root)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  if (!onChange || readOnly) {
    return (
      <div className={`activity-currency activity-currency--read-only${localizedLabels ? ' activity-currency--localized' : ''}`}>
        <span className="activity-currency-icon"><CircleDollarSign size={18} /></span>
        <b>{value}</b>
      </div>
    )
  }

  const selectCurrency = (code: CurrencyCode) => {
    onChange(code)
    setOpen(false)
    triggerRef.current!.focus()
  }

  return (
    <div ref={rootRef} className="currency-picker" onKeyDown={event => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current!.focus()
    }}>
      <button
        ref={triggerRef}
        type="button"
        className={`activity-currency${localizedLabels ? ' activity-currency--localized' : ''}`}
        aria-label={t('group.chooseCurrency', { currency: selectedLabel })}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <span className="activity-currency-icon"><CircleDollarSign size={18} /></span>
        <b>{value}</b>
        <ChevronDown className={open ? 'currency-chevron currency-chevron--open' : 'currency-chevron'} size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className={`currency-menu${localizedLabels ? ' currency-menu--localized' : ''}`} role="listbox" aria-label={t('group.currencyMenu')}>
          <div className="currency-menu-heading"><span>{t('group.currency')}</span><small>{t('group.currencyHelp')}</small></div>
          <div className="currency-options">
            {SUPPORTED_CURRENCIES.map(code => {
              const selected = code === currency
              const label = currencyLabel(code, locale)
              return (
                <button
                  type="button"
                  role="option"
                  aria-label={label}
                  aria-selected={selected}
                  className={selected ? 'currency-option currency-option--selected' : 'currency-option'}
                  key={code}
                  onClick={() => selectCurrency(code)}
                >
                  <span>{currencySymbol(code, locale)}</span>
                  <b>{label}</b>
                  {selected ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
