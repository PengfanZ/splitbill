import { useState, type FormEvent } from 'react'
import { ArrowRight, CircleDollarSign, Mic, Pencil, ReceiptText, Sparkles, Users } from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { ModalShell } from '../../components/Dialog'
import { Button } from '../../components/Button'
import { selectInputContents } from '../../components/inputInteractions'
import { SelectMenu, type SelectMenuOption } from '../../components/SelectMenu'
import { activityCurrency, currencyLabel, currencySymbol, defaultCurrencyForLocale, SUPPORTED_CURRENCIES, type CurrencyCode } from '../../domain/currency'
import { createEqualShares, createExactShares, createExpenseTimestamp, createSettlementPayment, money } from '../../domain/expenses'
import { makeId, mergeMemberNames } from '../../domain/members'
import type { ActivityGroup, Expense, Member, Settlement, SplitMethod } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'
import { AiExpenseComposer } from '../aiExpense/AiExpenseComposer'
import { AiExpenseBatchReview } from '../aiExpense/AiExpenseBatchReview'
import { VoiceExpenseComposer } from '../aiExpense/VoiceExpenseComposer'
import type { AiExpenseClient } from '../aiExpense/aiExpenseApi'
import type { AiExpenseReadyDraft } from '../aiExpense/aiExpenseContract'
import { createAiDraftFromValues, createExpenseFromAiDraft } from '../aiExpense/aiExpenseDrafts'
import { MAX_ACTIVITY_AMOUNT } from '../sharing/sharedActivity'
import { ReceiptSplitFlow } from '../receiptSplit/ReceiptSplitFlow'
import type { ReceiptClient } from '../receiptSplit/receiptApi'
import { ActivityIdentityControl } from './ActivityIdentityControl'
import { FriendNameInput } from './FriendNameInput'

export function CreateGroupModal({ onClose, onCurrencySelect, onSave }: {
  onClose: () => void
  onCurrencySelect?: (currency: CurrencyCode) => void
  onSave: (name: string, friendNames: string[], currency: CurrencyCode) => void
}) {
  const [name, setName] = useState('')
  const [friendDraft, setFriendDraft] = useState('')
  const [friendNames, setFriendNames] = useState<string[]>([])
  const { locale, t } = useLocalization()
  const [currency, setCurrency] = useState<CurrencyCode>(() => defaultCurrencyForLocale(locale))
  const currencyOptions: ReadonlyArray<SelectMenuOption<CurrencyCode>> = SUPPORTED_CURRENCIES.map(code => ({
    value: code,
    label: currencyLabel(code, locale),
    detail: `${code} · ${currencySymbol(code, locale)}`,
    leading: currencySymbol(code, locale),
  }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    onSave(name.trim(), mergeMemberNames(friendNames, friendDraft), currency)
  }

  const selectCurrency = (nextCurrency: CurrencyCode) => {
    if (nextCurrency === currency) return
    setCurrency(nextCurrency)
    onCurrencySelect?.(nextCurrency)
  }

  return (
    <ModalShell eyebrow={t('group.newEyebrow')} title={t('group.newTitle')} onClose={onClose} mobilePlacement="center">
      <form onSubmit={submit}>
        <label>{t('group.name')}<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t('group.namePlaceholder')} required /></label>
        <label>{t('group.currency')} <small>{t('group.currencyHelp')}</small><SelectMenu value={currency} options={currencyOptions} onChange={selectCurrency} ariaLabel={t('group.chooseCurrency', { currency: currencyLabel(currency, locale) })} menuLabel={t('group.currencyMenu')} /></label>
        <FriendNameInput fieldContext="group" draft={friendDraft} names={friendNames} onDraftChange={setFriendDraft} onNamesChange={setFriendNames} />
        <div className="split-note"><Users size={18} /><span>{t('group.included')}</span></div>
        <div className="modal-actions"><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit">{t('group.create')}</Button></div>
      </form>
    </ModalShell>
  )
}

export function AddFriendModal({ existingExpenseCount, onClose, onSave, saving = false }: { existingExpenseCount: number; onClose: () => void; onSave: (names: string[]) => void; saving?: boolean }) {
  const [draft, setDraft] = useState('')
  const [names, setNames] = useState<string[]>([])
  const { t } = useLocalization()
  const pendingNames = mergeMemberNames(names, draft)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!pendingNames.length) return
    onSave(pendingNames)
  }

  return (
    <ModalShell eyebrow={t('friend.eyebrow')} title={t('friend.title')} onClose={onClose} mobilePlacement="center">
      <form onSubmit={submit}>
        <FriendNameInput draft={draft} names={names} onDraftChange={setDraft} onNamesChange={setNames} />
        {existingExpenseCount ? <div className="split-note future-note"><Users size={18} /><span><b>{t('friend.futureOnly')}</b><small>{t(existingExpenseCount === 1 ? 'friend.existingOne' : 'friend.existingMany', { count: existingExpenseCount })}</small></span></div> : null}
        <div className="modal-actions"><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={saving || !pendingNames.length}>{t('friend.add')}</Button></div>
      </form>
    </ModalShell>
  )
}

export function SettleUpModal({ group, settlement, onClose, onSave, saving = false }: {
  group: ActivityGroup
  settlement: Settlement
  onClose: () => void
  onSave: (payment: Expense, settlement: Settlement) => void
  saving?: boolean
}) {
  const [amount, setAmount] = useState(settlement.amount.toFixed(2))
  const { locale, t } = useLocalization()
  const currency = activityCurrency(group)
  const numericAmount = Number(amount) || 0
  const amountCents = Math.round(numericAmount * 100)
  const suggestedCents = Math.round(settlement.amount * 100)
  const valid = amountCents > 0 && amountCents <= suggestedCents

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    onSave(createSettlementPayment(group.id, settlement, numericAmount, makeId('settlement')), settlement)
  }

  return (
    <ModalShell eyebrow={group.name} title={t('settlement.title')} onClose={onClose} mobilePlacement="center">
      <form onSubmit={submit}>
        <div className="settlement-parties" aria-label={t('settlement.parties', { from: settlement.from.name, to: settlement.to.name })}>
          <span><Avatar member={settlement.from} /><b>{settlement.from.name}</b><small>{t('settlement.pays')}</small></span>
          <ArrowRight size={20} />
          <span><Avatar member={settlement.to} /><b>{settlement.to.name}</b><small>{t('settlement.receives')}</small></span>
        </div>
        <label>{t('settlement.amount')} <small>{t('settlement.suggestedAmount', { amount: money(settlement.amount, currency, locale) })}</small><span className="modal-amount"><i>{currencySymbol(currency, locale)}</i><input autoFocus aria-label={t('settlement.amount')} value={amount} onChange={event => setAmount(event.target.value)} onFocus={selectInputContents} type="number" inputMode="decimal" min="0.01" max={settlement.amount.toFixed(2)} step="0.01" required /></span></label>
        {valid ? null : <small className="split-error" role="alert">{t('settlement.invalid', { minimum: money(0.01, currency, locale), amount: money(settlement.amount, currency, locale) })}</small>}
        <div className="split-note settlement-note"><CircleDollarSign size={18} /><span>{t('settlement.note')}</span></div>
        <div className="modal-actions"><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={!valid || saving}>{t('settlement.record')}</Button></div>
      </form>
    </ModalShell>
  )
}

export type ExpenseInputTab = 'manual' | 'ai-text' | 'ai-voice' | 'receipt'

type ExpenseEntryMode = ExpenseInputTab | 'ai-batch'

export function ExpenseModal({ group, members, expense, aiExpenseClient = null, receiptClient = null, currentMemberId = 'me', onCurrentMemberChange, onEntryTabSelect, onReceiptConfirmed, onClose, onSave, onSaveMany, saving = false }: {
  group: ActivityGroup
  members: Member[]
  expense?: Expense
  aiExpenseClient?: Pick<AiExpenseClient, 'parseBatch'> | null
  receiptClient?: Pick<ReceiptClient, 'parse'> | null
  currentMemberId?: string | null
  onCurrentMemberChange?: (memberId: string) => void
  onEntryTabSelect?: (tab: ExpenseInputTab) => void
  onReceiptConfirmed?: () => void
  onClose: () => void
  onSave: (expense: Expense) => void
  onSaveMany?: (expenses: Expense[]) => void
  saving?: boolean
}) {
  const { locale, t } = useLocalization()
  const currency = activityCurrency(group)
  const [title, setTitle] = useState(expense?.title ?? '')
  const [amount, setAmount] = useState(expense ? expense.amount.toString() : '')
  const [payerId, setPayerId] = useState(expense?.payerId ?? currentMemberId ?? members[0]?.id ?? 'me')
  const [method, setMethod] = useState<SplitMethod>(expense?.splitMethod ?? 'equal')
  const aiAvailable = Boolean(aiExpenseClient && !expense)
  const receiptAvailable = Boolean(receiptClient && !expense)
  const assistedEntryAvailable = aiAvailable || receiptAvailable
  const aiIdentityReady = Boolean(currentMemberId && members.some(member => member.id === currentMemberId))
  const [entryMode, setEntryMode] = useState<ExpenseEntryMode>('manual')
  const [aiDraftApplied, setAiDraftApplied] = useState(false)
  const [aiBatchDrafts, setAiBatchDrafts] = useState<AiExpenseReadyDraft[]>([])
  const [editingBatchIndex, setEditingBatchIndex] = useState<number | null>(null)
  const payerOptions: ReadonlyArray<SelectMenuOption<string>> = members.map(member => ({
    value: member.id,
    label: member.name,
    leading: <Avatar member={member} size="sm" />,
  }))
  const methodOptions: ReadonlyArray<SelectMenuOption<SplitMethod>> = [
    { value: 'equal', label: t('expense.equally') },
    { value: 'exact', label: t('expense.exactAmounts') },
  ]
  const [equalParticipantIds, setEqualParticipantIds] = useState<string[]>(() => {
    if (expense?.splitMethod !== 'equal') return members.map(member => member.id)
    const savedParticipantIds = new Set(Object.keys(expense.shares))
    return members.filter(member => savedParticipantIds.has(member.id)).map(member => member.id)
  })
  const [exactShares, setExactShares] = useState<Record<string, string>>(() => expense?.splitMethod === 'exact'
    ? Object.fromEntries(members.map(member => [member.id, expense.shares[member.id]?.toString() ?? '']))
    : {})
  const numericAmount = Number(amount) || 0
  const equalParticipants = members.filter(member => equalParticipantIds.includes(member.id))
  const exactTotal = members.reduce((sum, member) => sum + (Number(exactShares[member.id]) || 0), 0)
  const remaining = numericAmount - exactTotal
  const exactValid = Math.abs(remaining) < 0.005
  const splitValid = method === 'equal' ? equalParticipants.length > 0 : exactValid

  const toggleEqualParticipant = (memberId: string) => {
    setEqualParticipantIds(current => current.includes(memberId)
      ? current.filter(id => id !== memberId)
      : [...current, memberId])
  }

  const selectEntryTab = (tab: ExpenseInputTab) => {
    if (tab === entryMode) return
    onEntryTabSelect?.(tab)
    setEntryMode(tab)
  }

  const loadAiDraft = (draft: AiExpenseReadyDraft) => {
    const exactSharesById = new Map(draft.exactSharesCents.map(share => [share.memberId, share.amountCents]))
    setTitle(draft.title)
    setAmount(String(draft.amountCents / 100))
    setPayerId(draft.payerId)
    setMethod(draft.splitMethod)
    setEqualParticipantIds(draft.participantIds)
    setExactShares(Object.fromEntries(members.map(member => {
      const cents = exactSharesById.get(member.id)
      return [member.id, cents ? String(cents / 100) : '']
    })))
    setAiDraftApplied(true)
    setEntryMode('manual')
  }

  const applyAiDrafts = (drafts: AiExpenseReadyDraft[]) => {
    if (drafts.length === 1) {
      loadAiDraft(drafts[0])
      return
    }
    setAiBatchDrafts(drafts)
    setEditingBatchIndex(null)
    setEntryMode('ai-batch')
  }

  const editBatchDraft = (index: number) => {
    const draft = aiBatchDrafts[index]
    setEditingBatchIndex(index)
    loadAiDraft(draft)
  }

  const removeBatchDraft = (index: number) => {
    const nextDrafts = aiBatchDrafts.filter((_, draftIndex) => draftIndex !== index)
    setAiBatchDrafts(nextDrafts)
    if (nextDrafts.length === 0) setEntryMode('ai-text')
  }

  const saveAiBatch = () => {
    const savedAt = createExpenseTimestamp()
    const expenses = aiBatchDrafts.map(draft => createExpenseFromAiDraft(group.id, draft, members, makeId('expense'), savedAt))
    if (onSaveMany) onSaveMany(expenses)
    else expenses.forEach(onSave)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || numericAmount <= 0 || !splitValid) return
    if (editingBatchIndex !== null) {
      const draft = createAiDraftFromValues({
        amount: numericAmount,
        equalParticipantIds,
        exactShares,
        members,
        method,
        payerId,
        title,
      })
      setAiBatchDrafts(current => current.map((item, index) => index === editingBatchIndex ? draft : item))
      setEditingBatchIndex(null)
      setEntryMode('ai-batch')
      return
    }
    const shares = method === 'equal'
      ? createEqualShares(equalParticipants, numericAmount)
      : createExactShares(members, exactShares)
    const savedAt = createExpenseTimestamp()
    onSave({
      id: expense?.id ?? makeId('expense'),
      groupId: group.id,
      title: title.trim(),
      amount: numericAmount,
      payerId,
      splitMethod: method,
      shares,
      createdAt: expense?.createdAt ?? savedAt,
      ...(expense ? { updatedAt: savedAt } : {}),
    })
  }

  return (
    <ModalShell eyebrow={group.name} title={t(entryMode === 'receipt' ? 'receipt.title' : expense ? 'expense.editTitle' : 'expense.addTitle')} onClose={onClose} size={entryMode === 'receipt' ? 'wide' : 'standard'}>
      {assistedEntryAvailable && aiBatchDrafts.length === 0 ? (
        <div className={`expense-entry-tabs expense-entry-tabs--${1 + (aiAvailable ? 2 : 0) + (receiptAvailable ? 1 : 0)}`} role="tablist" aria-label={t('expense.entryMethod')}>
          <button type="button" role="tab" aria-selected={entryMode === 'manual'} className={entryMode === 'manual' ? 'active' : ''} onClick={() => selectEntryTab('manual')}><Pencil size={15} />{t('expense.manualTab')}</button>
          {aiAvailable ? <button type="button" role="tab" aria-selected={entryMode === 'ai-text'} className={entryMode === 'ai-text' ? 'active' : ''} onClick={() => selectEntryTab('ai-text')}><Sparkles size={15} />{t('expense.aiTab')}</button> : null}
          {aiAvailable ? <button type="button" role="tab" aria-selected={entryMode === 'ai-voice'} className={entryMode === 'ai-voice' ? 'active' : ''} onClick={() => selectEntryTab('ai-voice')}><Mic size={15} />{t('expense.voiceTab')}</button> : null}
          {receiptAvailable ? <button type="button" role="tab" aria-selected={entryMode === 'receipt'} className={entryMode === 'receipt' ? 'active' : ''} onClick={() => selectEntryTab('receipt')}><ReceiptText size={15} />{t('expense.receiptTab')}</button> : null}
        </div>
      ) : null}
      {aiAvailable && (entryMode === 'ai-text' || entryMode === 'ai-voice') && onCurrentMemberChange ? (
        <div className="ai-identity-control-row">
          <ActivityIdentityControl memberId={currentMemberId} members={members} onChange={onCurrentMemberChange} variant="field" />
        </div>
      ) : null}
      {receiptAvailable && entryMode === 'receipt' && receiptClient ? (
        <ReceiptSplitFlow
          client={receiptClient}
          group={group}
          members={members}
          onBackToManual={() => setEntryMode('manual')}
          onConfirmed={onReceiptConfirmed}
          onSave={onSave}
          saving={saving}
        />
      ) : aiAvailable && (entryMode === 'ai-text' || entryMode === 'ai-voice') && !aiIdentityReady ? (
        <div className="split-note ai-identity-required" role="status"><Sparkles size={18} /><span>{t('activityIdentity.required')}</span></div>
      ) : aiAvailable && entryMode === 'ai-text' && aiExpenseClient && currentMemberId ? (
        <AiExpenseComposer
          client={aiExpenseClient}
          currency={currency}
          members={members}
          viewerMemberId={currentMemberId}
          onClose={onClose}
          onDrafts={applyAiDrafts}
        />
      ) : aiAvailable && entryMode === 'ai-voice' && aiExpenseClient && currentMemberId ? (
        <VoiceExpenseComposer
          client={aiExpenseClient}
          currency={currency}
          members={members}
          viewerMemberId={currentMemberId}
          onClose={onClose}
          onDrafts={applyAiDrafts}
        />
      ) : entryMode === 'ai-batch' ? (
        <AiExpenseBatchReview
          currency={currency}
          drafts={aiBatchDrafts}
          members={members}
          onCancel={onClose}
          onEdit={editBatchDraft}
          onRemove={removeBatchDraft}
          onSave={saveAiBatch}
          saving={saving}
        />
      ) : entryMode === 'manual' ? <form onSubmit={submit}>
        {aiDraftApplied ? <div className="split-note ai-draft-note" role="status"><Sparkles size={18} /><span><b>{t(editingBatchIndex === null ? 'expense.aiDraftReady' : 'expense.batchEditing', editingBatchIndex === null ? undefined : { current: editingBatchIndex + 1, total: aiBatchDrafts.length })}</b><small>{t(editingBatchIndex === null ? 'expense.aiDraftReview' : 'expense.batchEditingHelp')}</small></span></div> : null}
        <label>{t('expense.description')}<input autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder={t('expense.descriptionPlaceholder')} maxLength={200} required /></label>
        <label>{t('expense.amount')}<span className="modal-amount"><i>{currencySymbol(currency, locale)}</i><input aria-label={t('expense.amount')} value={amount} onChange={event => setAmount(event.target.value)} onFocus={selectInputContents} type="number" inputMode="decimal" min="0.01" max={MAX_ACTIVITY_AMOUNT} step="0.01" placeholder="0.00" required /></span></label>
        <div className="form-grid">
          <label>{t('expense.paidBy')}<SelectMenu value={payerId} options={payerOptions} onChange={setPayerId} ariaLabel={t('expense.paidBy')} menuLabel={t('expense.paidBy')} /></label>
          <label>{t('expense.splitMethod')}<SelectMenu value={method} options={methodOptions} onChange={setMethod} ariaLabel={t('expense.splitMethod')} menuLabel={t('expense.splitMethod')} /></label>
        </div>
        {method === 'equal' ? (
          <div className="equal-splits">
            <div className="equal-heading"><span>{t('expense.splitBetween')}</span><b>{t('expense.selectedCount', { selected: equalParticipants.length, total: members.length })}</b></div>
            <div className="equal-member-list">
              {members.map(member => (
                <label className="equal-member" key={member.id}>
                  <span><Avatar member={member} size="sm" />{member.name}</span>
                  <input
                    aria-label={t('expense.includeMember', { name: member.name })}
                    type="checkbox"
                    checked={equalParticipantIds.includes(member.id)}
                    onChange={() => toggleEqualParticipant(member.id)}
                  />
                </label>
              ))}
            </div>
            <div className="split-preview">
              <span><Users size={18} />{t('expense.eachShare')}</span>
              <strong>{money(equalParticipants.length ? numericAmount / equalParticipants.length : 0, currency, locale)}</strong>
            </div>
            {equalParticipants.length ? null : <small className="split-error" role="alert">{t('expense.selectOne')}</small>}
          </div>
        ) : (
          <div className="exact-splits">
            <div className="exact-heading"><span>{t('expense.enterShares')}</span><b className={exactValid ? 'positive' : remaining < 0 ? 'negative' : ''}>{t(remaining >= 0 ? 'expense.left' : 'expense.over', { amount: money(remaining, currency, locale) })}</b></div>
            {members.map(member => <label className="share-row" key={member.id}><span><Avatar member={member} size="sm" />{member.name}</span><span className="share-input"><i>{currencySymbol(currency, locale)}</i><input aria-label={t('expense.memberShare', { name: member.name })} type="number" inputMode="decimal" min="0" max={MAX_ACTIVITY_AMOUNT} step="0.01" value={exactShares[member.id] ?? ''} onChange={event => setExactShares(current => ({ ...current, [member.id]: event.target.value }))} onFocus={selectInputContents} placeholder="0.00" /></span></label>)}
          </div>
        )}
        {expense ? <div className="split-note edit-note"><Pencil size={17} /><span>{method === 'equal' ? t('expense.editEqualNote') : t('expense.editExactNote', { count: members.length })}</span></div> : null}
        <div className="modal-actions"><Button onClick={editingBatchIndex === null ? onClose : () => { setEditingBatchIndex(null); setEntryMode('ai-batch') }}>{t(editingBatchIndex === null ? 'common.cancel' : 'expense.batchBack')}</Button><Button variant="primary" type="submit" disabled={!splitValid || saving}>{t(editingBatchIndex === null ? (expense ? 'expense.saveChanges' : 'expense.save') : 'expense.batchUpdate')}</Button></div>
      </form> : null}
    </ModalShell>
  )
}
