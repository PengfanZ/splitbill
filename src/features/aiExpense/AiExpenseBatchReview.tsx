import { Pencil, Sparkles, Trash2, Users } from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { money } from '../../domain/expenses'
import type { CurrencyCode } from '../../domain/currency'
import type { Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'
import type { AiExpenseReadyDraft } from './aiExpenseContract'

export function AiExpenseBatchReview({
  currency,
  drafts,
  members,
  onCancel,
  onEdit,
  onRemove,
  onSave,
  saving,
}: {
  currency: CurrencyCode
  drafts: AiExpenseReadyDraft[]
  members: Member[]
  onCancel: () => void
  onEdit: (index: number) => void
  onRemove: (index: number) => void
  onSave: () => void
  saving: boolean
}) {
  const { locale, t } = useLocalization()
  const membersById = new Map(members.map(member => [member.id, member]))

  return (
    <section className="ai-batch-review" aria-labelledby="ai-batch-heading">
      <div className="ai-expense-intro ai-batch-intro">
        <span><Sparkles size={18} /></span>
        <div>
          <b id="ai-batch-heading">{t(drafts.length === 1 ? 'expense.aiDraftReady' : 'expense.batchReady', { count: drafts.length })}</b>
          <p>{t('expense.batchReview')}</p>
        </div>
      </div>

      <ol className="ai-batch-list">
        {drafts.map((draft, index) => {
          const payer = membersById.get(draft.payerId)
          return (
            <li className="ai-batch-card" key={`${draft.title}-${draft.payerId}-${index}`}>
              <div className="ai-batch-index" aria-hidden="true">{index + 1}</div>
              <div className="ai-batch-card-body">
                <div className="ai-batch-card-heading">
                  <b>{draft.title}</b>
                  <strong>{money(draft.amountCents / 100, currency, locale)}</strong>
                </div>
                <p>
                  {payer ? <Avatar member={payer} size="sm" /> : null}
                  <span>{t('expense.batchPaidBy', { payer: payer?.name ?? t('common.unknown') })}</span>
                  <span aria-hidden="true">·</span>
                  <span><Users size={14} />{t('expense.batchPeople', { count: draft.participantIds.length })}</span>
                </p>
              </div>
              <div className="ai-batch-card-actions">
                <button type="button" onClick={() => onEdit(index)} aria-label={t('expense.batchEdit', { title: draft.title })}><Pencil size={15} /></button>
                <button type="button" onClick={() => onRemove(index)} aria-label={t('expense.batchRemove', { title: draft.title })}><Trash2 size={15} /></button>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="split-note ai-privacy-note">
        <Sparkles size={18} />
        <span>{t('expense.batchNothingSaved')}</span>
      </div>
      <div className="modal-actions">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant="primary" onClick={onSave} disabled={saving || drafts.length === 0}>
          {t(drafts.length === 1 ? 'expense.save' : 'expense.batchSave', { count: drafts.length })}
        </Button>
      </div>
    </section>
  )
}
