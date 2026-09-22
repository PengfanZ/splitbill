import { ChevronRight, Tag } from 'lucide-react'
import { Button } from '../../components/Button'
import { categoryLabel, categorySummary } from '../../domain/categories'
import { activityCurrency } from '../../domain/currency'
import { money } from '../../domain/expenses'
import type { ActivityGroup, Expense } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export function CategorySummary({ group, expenses, selected, onSelect, onManage }: { group: ActivityGroup; expenses: Expense[]; selected: string | null; onSelect: (id: string | null) => void; onManage?: () => void }) {
  const { locale, t } = useLocalization()
  const rows = categorySummary(group, expenses)
  const total = rows.reduce((sum, row) => sum + row.cents, 0)
  return <section className="content-section category-summary" aria-label={t('categories.summary')}>
    <div className="section-heading"><h2>{t('categories.summary')}</h2>{onManage ? <Button onClick={onManage}><Tag size={16} />{t('categories.manage')}</Button> : null}</div>
    <p className="category-help">{t('categories.excluded')}</p>
    {rows.length ? <div className="category-bars">{rows.map(row => <button type="button" key={row.category.id} className="category-bar" aria-pressed={selected === row.category.id} onClick={() => onSelect(selected === row.category.id ? null : row.category.id)}>
      <span className="category-dot" style={{ backgroundColor: row.category.color }} />
      <span className="category-bar-name">{categoryLabel(row.category, locale)}<small>{t(row.count === 1 ? 'categories.countOne' : 'categories.count', { count: row.count })}</small></span>
      <span className="category-bar-track"><span style={{ width: `${total ? row.cents / total * 100 : 0}%`, backgroundColor: row.category.color }} /></span>
      <strong>{money(row.cents / 100, activityCurrency(group), locale)}</strong><ChevronRight size={16} />
    </button>)}</div> : <p>{t('categories.emptySummary')}</p>}
    {selected !== null ? <Button variant="ghost" onClick={() => onSelect(null)}>{t('categories.all')}</Button> : null}
  </section>
}
