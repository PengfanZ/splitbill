import { useState, type CSSProperties } from 'react'
import { Check, LockKeyhole, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { Button, IconButton } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
import { activityCategories, CATEGORY_COLORS, categoryLabel, categoryNameError, GENERAL_CATEGORY, MAX_CATEGORIES, type CategoryChange } from '../../domain/categories'
import { makeId } from '../../domain/members'
import type { ActivityGroup, Expense, ExpenseCategory } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export function CategoryManager({ group, expenses, onChange, onClose }: { group: ActivityGroup; expenses: Expense[]; onChange: (change: CategoryChange) => Promise<boolean>; onClose: () => void }) {
  const { locale, t } = useLocalization()
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ExpenseCategory | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const categories = activityCategories(group)
  const startEdit = (category: ExpenseCategory | 'new') => {
    setEditing(category)
    setName(category === 'new' ? '' : categoryLabel(category, locale))
    setColor(category === 'new' ? CATEGORY_COLORS[0] : category.color)
    setError('')
  }
  const save = async (change: CategoryChange) => {
    setSaving(true)
    setError('')
    try {
      if (!await onChange(change)) { setError(t('categories.failed')); return }
      setEditing(null)
      setDeleting(null)
    } catch { setError(t('categories.failed')) }
    finally { setSaving(false) }
  }
  const title = deleting ? t('categories.deleteTitle', { name: categoryLabel(deleting, locale) })
    : editing ? t(editing === 'new' ? 'categories.create' : 'categories.edit') : t('categories.manage')
  return <ModalShell title={title} bodyClassName="category-manager-body" onClose={saving ? undefined : onClose}>
    {editing ? <form className="category-editor" onSubmit={event => {
      event.preventDefault()
      const id = editing === 'new' ? makeId('category') : editing.id
      if (editing !== 'new' && !categories.some(category => category.id === id)) { setError(t('categories.failed')); return }
      const problem = categoryNameError(name, categories, id)
      if (problem) { setError(t(`categories.${problem}`)); return }
      const storedName = editing !== 'new' && name.trim() === categoryLabel(editing, locale) ? editing.name : name.trim()
      void save({ kind: 'save', category: { id, name: storedName, color } })
    }}>
      <div className="category-editor-preview" style={{ '--category-color': color } as CSSProperties}><Tag size={22} aria-hidden="true" /><span>{name.trim() || t('categories.name')}</span></div>
      <label>{t('categories.name')}<input autoFocus value={name} maxLength={32} onChange={event => setName(event.target.value)} disabled={saving} /></label>
      <fieldset className="category-colors"><legend>{t('categories.color')}</legend>{CATEGORY_COLORS.map(value => <button key={value} type="button" style={{ backgroundColor: value }} aria-label={`${t('categories.color')} ${value}`} aria-pressed={value === color} onClick={() => setColor(value)} disabled={saving}>{value === color ? <Check size={18} aria-hidden="true" /> : null}</button>)}</fieldset>
      <div className="modal-actions"><Button disabled={saving} onClick={() => { setEditing(null); setError('') }}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={saving}>{t('categories.save')}</Button></div>
    </form> : deleting ? <>
      <p>{t('categories.deleteWarning', { count: expenses.filter(expense => expense.categoryId === deleting.id).length })}</p>
      <div className="modal-actions"><Button disabled={saving} onClick={() => { setDeleting(null); setError('') }}>{t('common.cancel')}</Button><Button variant="danger" disabled={saving} onClick={() => void save({ kind: 'delete', id: deleting.id })}>{t('categories.delete')}</Button></div>
    </> : <div className="category-manager">
      <p className="category-help">{t('categories.help')}</p>
      <div className="category-manager-list">
        <div className="category-manager-row category-manager-default">
          <span className="category-manager-swatch" style={{ '--category-color': GENERAL_CATEGORY.color } as CSSProperties}><Tag size={18} aria-hidden="true" /></span>
          <span className="category-manager-copy"><strong>{categoryLabel(GENERAL_CATEGORY, locale)}</strong><small>{t('categories.default')}</small></span>
          <LockKeyhole size={16} className="category-lock" aria-hidden="true" />
        </div>
        {categories.map(category => {
          const count = expenses.filter(expense => expense.groupId === group.id && expense.kind !== 'settlement' && expense.categoryId === category.id).length
          return <div className="category-manager-row" key={category.id}>
            <span className="category-manager-swatch" style={{ '--category-color': category.color } as CSSProperties}><Tag size={18} aria-hidden="true" /></span>
            <button className="category-manager-copy category-edit-link" aria-label={t('categories.renameLabel', { name: categoryLabel(category, locale) })} onClick={() => startEdit(category)}><span><strong>{categoryLabel(category, locale)}</strong><small>{t(count === 1 ? 'categories.countOne' : 'categories.count', { count })}</small></span><Pencil size={15} className="category-edit-hint" aria-hidden="true" /></button>
            <IconButton tone="danger" label={t('categories.deleteLabel', { name: categoryLabel(category, locale) })} onClick={() => { setDeleting(category); setError('') }}><Trash2 size={16} /></IconButton>
          </div>
        })}
      </div>
      <Button className="category-create-button" variant="primary" disabled={categories.length >= MAX_CATEGORIES} onClick={() => startEdit('new')}><Plus size={18} />{t('categories.create')}</Button>
      {categories.length >= MAX_CATEGORIES ? <p>{t('categories.limit')}</p> : null}
    </div>}
    {error ? <p className="split-error" role="alert">{error}</p> : null}
  </ModalShell>
}
