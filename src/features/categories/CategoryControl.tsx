import { SelectMenu } from '../../components/SelectMenu'
import { Settings2 } from 'lucide-react'
import { activityCategories, categoryLabel, GENERAL_CATEGORY } from '../../domain/categories'
import type { ActivityGroup } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export function CategoryControl({ group, value, onChange, onManage }: { group: ActivityGroup; value: string | null; onChange: (id: string | null) => void; onManage?: () => void }) {
  const { locale, t } = useLocalization()
  return <SelectMenu
    ariaLabel={t('categories.label')}
    menuLabel={t('categories.select')}
    value={value ?? ''}
    onChange={id => onChange(id || null)}
    footerAction={onManage ? { label: t('categories.manage'), icon: <Settings2 size={16} aria-hidden="true" />, onClick: onManage } : undefined}
    options={[GENERAL_CATEGORY, ...activityCategories(group)].map(category => ({
      value: category.id,
      label: categoryLabel(category, locale),
      leading: <span className="category-dot" style={{ backgroundColor: category.color }} />,
    }))}
  />
}
