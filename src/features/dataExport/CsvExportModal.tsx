import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet, UserRound, UsersRound } from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
import { SelectMenu, type SelectMenuOption } from '../../components/SelectMenu'
import { activityCurrency } from '../../domain/currency'
import { money } from '../../domain/expenses'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'
import {
  buildCsvExportRows,
  csvExportFilename,
  csvExportPreview,
  downloadCsv,
  memberCategoryTotals,
  serializeCsv,
  type CsvExportScope,
} from './activityCsv'

export function CsvExportModal({
  currentMemberId,
  expenses,
  group,
  members,
  onClose,
  onDownloaded,
}: {
  currentMemberId?: string | null
  expenses: Expense[]
  group: ActivityGroup
  members: Member[]
  onClose: () => void
  onDownloaded?: (scope: CsvExportScope) => void
}) {
  const { locale, t } = useLocalization()
  const defaultMemberId = members.some(member => member.id === currentMemberId)
    ? currentMemberId!
    : members[0]?.id ?? ''
  const [scopeType, setScopeType] = useState<CsvExportScope['type']>('member')
  const [memberId, setMemberId] = useState(defaultMemberId)
  const memberOptions: ReadonlyArray<SelectMenuOption<string>> = members.map(member => ({
    value: member.id,
    label: member.name,
    leading: <Avatar member={member} size="sm" />,
  }))
  const selectedMember = members.find(member => member.id === memberId) ?? null
  const scope = useMemo<CsvExportScope>(() => scopeType === 'activity'
    ? { type: 'activity' }
    : { type: 'member', memberId }, [memberId, scopeType])
  const rows = useMemo(
    () => buildCsvExportRows(group, members, expenses, scope),
    [expenses, group, members, scope],
  )
  const preview = useMemo(() => csvExportPreview(rows), [rows])
  const categories = useMemo(
    () => scopeType === 'member' && memberId ? memberCategoryTotals(expenses, memberId) : [],
    [expenses, memberId, scopeType],
  )
  const currency = activityCurrency(group)

  const exportCsv = () => {
    downloadCsv(
      serializeCsv(rows),
      csvExportFilename(group.name, scope.type === 'member' ? selectedMember?.name ?? null : null),
    )
    onDownloaded?.(scope)
    onClose()
  }

  return (
    <ModalShell
      eyebrow={group.name}
      title={t('csvExport.title')}
      description={t('csvExport.description')}
      onClose={onClose}
      size="wide"
      bodyClassName="csv-export-body"
    >
      <div className="csv-export-scopes" role="group" aria-label={t('csvExport.scopeLabel')}>
        <button type="button" aria-pressed={scopeType === 'member'} className={scopeType === 'member' ? 'csv-scope is-selected' : 'csv-scope'} onClick={() => setScopeType('member')}>
          <span className="csv-scope-icon"><UserRound size={20} /></span>
          <span><b>{t('csvExport.onePerson')}</b><small>{t('csvExport.onePersonHelp')}</small></span>
        </button>
        <button type="button" aria-pressed={scopeType === 'activity'} className={scopeType === 'activity' ? 'csv-scope is-selected' : 'csv-scope'} onClick={() => setScopeType('activity')}>
          <span className="csv-scope-icon"><UsersRound size={20} /></span>
          <span><b>{t('csvExport.fullActivity')}</b><small>{t('csvExport.fullActivityHelp')}</small></span>
        </button>
      </div>

      {scopeType === 'member' && memberOptions.length ? (
        <label className="csv-member-field">
          {t('csvExport.person')}
          <SelectMenu value={memberId} options={memberOptions} onChange={setMemberId} ariaLabel={t('csvExport.person')} menuLabel={t('csvExport.personMenu')} />
        </label>
      ) : null}

      <section className="csv-preview" aria-label={t('csvExport.preview')}>
        <div className="csv-preview-heading">
          <span><FileSpreadsheet size={18} /></span>
          <div><b>{t('csvExport.preview')}</b><small>{t(scopeType === 'member' ? 'csvExport.personalExplanation' : 'csvExport.activityExplanation')}</small></div>
        </div>
        <div className="csv-preview-metrics">
          {scopeType === 'member' ? (
            <>
              <div><span>{t('csvExport.personalSpending')}</span><strong>{money(preview.personalShare, currency, locale)}</strong></div>
              <div><span>{t('csvExport.paidUpfront')}</span><strong>{money(preview.personalPaid, currency, locale)}</strong></div>
              <div><span>{t('csvExport.settlementFlow')}</span><strong>{preview.settlementFlow < 0 ? '−' : preview.settlementFlow > 0 ? '+' : ''}{money(preview.settlementFlow, currency, locale)}</strong></div>
              <div><span>{t('csvExport.rows')}</span><strong>{preview.rowCount}</strong></div>
            </>
          ) : (
            <>
              <div><span>{t('csvExport.expenses')}</span><strong>{preview.expenseCount}</strong></div>
              <div><span>{t('csvExport.settlements')}</span><strong>{preview.settlementCount}</strong></div>
              <div><span>{t('csvExport.people')}</span><strong>{members.length}</strong></div>
              <div><span>{t('csvExport.rows')}</span><strong>{preview.rowCount}</strong></div>
            </>
          )}
        </div>
        {categories.length ? (
          <div className="csv-category-preview">
            <span>{t('csvExport.categoryBreakdown')}</span>
            <div>{categories.map(item => <span key={item.category}><b>{t(`expense.category.${item.category}`)}</b>{money(item.amount, currency, locale)}</span>)}</div>
          </div>
        ) : null}
      </section>

      <div className="csv-includes">
        <b>{t('csvExport.includes')}</b>
        <p>{t('csvExport.includesHelp')}</p>
      </div>

      {!rows.length ? <small className="split-error" role="alert">{t('csvExport.noRows')}</small> : null}
      <div className="modal-actions">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={exportCsv} disabled={!rows.length}><Download size={17} />{t('csvExport.download')}</Button>
      </div>
    </ModalShell>
  )
}
