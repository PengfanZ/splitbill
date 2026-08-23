import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ImagePlus,
  LoaderCircle,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { selectInputContents } from '../../components/inputInteractions'
import { SelectMenu, type SelectMenuOption } from '../../components/SelectMenu'
import { activityCurrency, currencyLabel, currencySymbol } from '../../domain/currency'
import { createExpenseTimestamp, money } from '../../domain/expenses'
import { makeId } from '../../domain/members'
import type { ActivityGroup, Expense, Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'
import type { Translate } from '../../i18n/localization'
import { prepareReceiptImage } from './receiptImage'
import { ReceiptApiError, type ReceiptClient } from './receiptApi'
import {
  calculateReceiptSplit,
  createExpenseFromReceiptSplit,
  type ReceiptAssignment,
  type ReceiptChargeAllocationMethod,
  type ReceiptChargeSetting,
} from './receiptAllocation'
import {
  addUnrecognizedReceiptCharge,
  addUnrecognizedReceiptItem,
  MAX_RECEIPT_CHARGES,
  MAX_RECEIPT_ITEMS,
  reconcileReceipt,
  type ReceiptDraft,
} from './receiptContract'

type ReceiptStep = 'capture' | 'reading' | 'review' | 'assign' | 'confirm'

type ReceiptSplitFlowProps = {
  client: Pick<ReceiptClient, 'parse'>
  group: ActivityGroup
  members: Member[]
  onBackToManual: () => void
  onSave: (expense: Expense) => void
  onConfirmed?: () => void
  saving?: boolean
}

function centsFromInput(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0
}

function amountInput(cents: number) {
  return (cents / 100).toFixed(2)
}

function receiptErrorMessage(cause: unknown, t: Translate) {
  if (cause instanceof ReceiptApiError) {
    if (cause.kind === 'rate-limit') return t('receipt.rateLimit')
    if (cause.kind === 'credits') return t('receipt.credits')
    if (['model-unavailable', 'network', 'unavailable', 'configuration'].includes(cause.kind)) {
      return t('receipt.unavailable')
    }
    return t('receipt.error')
  }
  return cause instanceof Error ? cause.message : t('receipt.error')
}

function ReceiptMoneyInput({ ariaLabel, min, onValueChange, valueCents }: {
  ariaLabel: string
  min?: number
  onValueChange: (value: string) => void
  valueCents: number
}) {
  const focused = useRef(false)
  const [value, setValue] = useState(() => amountInput(valueCents))

  useEffect(() => {
    if (!focused.current) setValue(amountInput(valueCents))
  }, [valueCents])

  return (
    <input
      aria-label={ariaLabel}
      type="number"
      inputMode="decimal"
      min={min}
      step="0.01"
      value={value}
      onBlur={() => {
        focused.current = false
        setValue(amountInput(valueCents))
      }}
      onChange={event => {
        setValue(event.target.value)
        onValueChange(event.target.value)
      }}
      onFocus={event => {
        focused.current = true
        selectInputContents(event)
      }}
    />
  )
}

function chargeSettings(draft: ReceiptDraft): ReceiptChargeSetting[] {
  return draft.charges.map(charge => ({ ...charge, allocationMethod: 'proportional' }))
}

function buildTipCharge(draft: ReceiptDraft, tipPercent: number): ReceiptChargeSetting | null {
  if (tipPercent <= 0 || draft.charges.some(charge => charge.type === 'tip')) return null
  return {
    id: 'user-tip',
    type: 'tip',
    label: `Tip ${tipPercent}%`,
    amountCents: Math.round(draft.subtotalCents * tipPercent / 100),
    rateBasisPoints: Math.round(tipPercent * 100),
    confidence: 'high',
    allocationMethod: 'proportional',
  }
}

export function ReceiptSplitFlow({
  client,
  group,
  members,
  onBackToManual,
  onConfirmed,
  onSave,
  saving = false,
}: ReceiptSplitFlowProps) {
  const { locale, t } = useLocalization()
  const activityCurrencyCode = activityCurrency(group)
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<ReceiptStep>('capture')
  const [draft, setDraft] = useState<ReceiptDraft | null>(null)
  const [assignments, setAssignments] = useState<ReceiptAssignment>({})
  const [assignmentIndex, setAssignmentIndex] = useState(0)
  const [charges, setCharges] = useState<ReceiptChargeSetting[]>([])
  const [payerId, setPayerId] = useState(members[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [tipPercent, setTipPercent] = useState(0)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [unresolvedConfirmed, setUnresolvedConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const payerOptions: ReadonlyArray<SelectMenuOption<string>> = members.map(member => ({
    value: member.id,
    label: member.name,
    leading: <Avatar member={member} size="sm" />,
  }))
  const chargeMethodOptions: ReadonlyArray<SelectMenuOption<ReceiptChargeAllocationMethod>> = [
    { value: 'proportional', label: t('receipt.proportional') },
    { value: 'equal', label: t('receipt.equal') },
  ]

  const reconciliation = draft ? reconcileReceipt(draft) : null
  const currencyMatches = !draft?.currency || draft.currency === activityCurrencyCode
  const reviewReady = Boolean(
    draft
    && reconciliation?.matches
    && currencyMatches
    && (!draft.unresolvedLines.length || unresolvedConfirmed),
  )
  const allItemsAssigned = Boolean(draft?.items.every(item => (assignments[item.id]?.length ?? 0) > 0))
  const finalCharges = useMemo(() => {
    if (!draft) return charges
    const tip = buildTipCharge(draft, tipPercent)
    return tip ? [...charges, tip] : charges
  }, [charges, draft, tipPercent])
  const split = useMemo(() => {
    if (!draft || !allItemsAssigned) return null
    try {
      return calculateReceiptSplit(draft, members, assignments, finalCharges)
    } catch {
      return null
    }
  }, [allItemsAssigned, assignments, draft, finalCharges, members])

  const resetCapture = () => {
    setError(null)
    setDraft(null)
    setStep('capture')
  }

  const readReceipt = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setStep('reading')
    try {
      const image = await prepareReceiptImage(file)
      const result = await client.parse({ image, locale, currency: activityCurrencyCode })
      setDraft(result)
      setTitle(result.merchant?.trim() || t('receipt.title'))
      setCharges(chargeSettings(result))
      setAssignments({})
      setAssignmentIndex(0)
      setTipPercent(0)
      setUnresolvedConfirmed(result.unresolvedLines.length === 0)
      setStep('review')
    } catch (cause) {
      setError(receiptErrorMessage(cause, t))
      setStep('capture')
    }
  }

  const updateItem = (itemId: string, update: (item: ReceiptDraft['items'][number]) => ReceiptDraft['items'][number]) => {
    setDraft(current => ({
      ...current!,
      items: current!.items.map(item => item.id === itemId ? update(item) : item),
    }))
  }

  const updateCharge = (chargeId: string, amountCents: number) => {
    setDraft(current => ({
      ...current!,
      charges: current!.charges.map(charge => charge.id === chargeId ? { ...charge, amountCents } : charge),
    }))
    setCharges(current => current.map(charge => charge.id === chargeId ? { ...charge, amountCents } : charge))
  }

  const addMissingItem = () => {
    const currentDraft = draft!
    const nextDraft = addUnrecognizedReceiptItem(
      currentDraft,
      makeId('receipt-item'),
      t('receipt.unrecognizedItem'),
      t('receipt.unrecognizedItemDetail'),
    )
    setDraft(nextDraft)
  }

  const addMissingCharge = () => {
    const currentDraft = draft!
    const nextDraft = addUnrecognizedReceiptCharge(
      currentDraft,
      makeId('receipt-charge'),
      t('receipt.unrecognizedCharge'),
    )
    setDraft(nextDraft)
    setCharges(chargeSettings(nextDraft))
  }

  const toggleAssignment = (itemId: string, memberId: string) => {
    setAssignments(current => {
      const selected = current[itemId] ?? []
      return {
        ...current,
        [itemId]: selected.includes(memberId)
          ? selected.filter(id => id !== memberId)
          : [...selected, memberId],
      }
    })
  }

  const assignEveryone = (itemId: string) => {
    setAssignments(current => ({
      ...current,
      [itemId]: members.map(member => member.id),
    }))
  }

  const clearAssignment = (itemId: string) => {
    setAssignments(current => ({ ...current, [itemId]: [] }))
  }

  const setChargeMethod = (chargeId: string, allocationMethod: ReceiptChargeAllocationMethod) => {
    setCharges(current => current.map(charge => charge.id === chargeId
      ? { ...charge, allocationMethod }
      : charge))
  }

  const saveReceipt = () => {
    const expense = createExpenseFromReceiptSplit({
      createdAt: createExpenseTimestamp(),
      groupId: group.id,
      id: makeId('expense'),
      payerId,
      result: split!,
      title,
    })
    onSave(expense)
    onConfirmed?.()
  }

  if (step === 'reading') {
    return (
      <div className="receipt-flow receipt-reading" role="status">
        <span className="receipt-reading-icon"><LoaderCircle size={28} /></span>
        <div><h3>{t('receipt.reading')}</h3><p>{t('receipt.readingHelp')}</p></div>
        <div className="receipt-reading-lines" aria-hidden="true"><i /><i /><i /><i /></div>
        <Button onClick={resetCapture}>{t('common.cancel')}</Button>
      </div>
    )
  }

  if (step === 'capture') {
    return (
      <div className="receipt-flow receipt-capture">
        <div className="receipt-step-intro">
          <span><ReceiptText size={23} /></span>
          <div><h3>{t('receipt.captureTitle')}</h3><p>{t('receipt.captureHelp')}</p></div>
        </div>
        <div className="receipt-photo-actions">
          <button type="button" className="receipt-photo-action receipt-photo-action--primary" onClick={() => cameraInput.current?.click()}>
            <Camera size={25} /><b>{t('receipt.takePhoto')}</b><small>{t('receipt.formats')}</small>
          </button>
          <button type="button" className="receipt-photo-action" onClick={() => libraryInput.current?.click()}>
            <ImagePlus size={25} /><b>{t('receipt.choosePhoto')}</b><small>{t('receipt.formats')}</small>
          </button>
          <input ref={cameraInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={readReceipt} />
          <input ref={libraryInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={readReceipt} />
        </div>
        {error ? <div className="receipt-error" role="alert"><AlertCircle size={18} /><span><b>{t('receipt.error')}</b><small>{error}</small></span><Button onClick={resetCapture}>{t('receipt.tryAgain')}</Button></div> : null}
        <div className="split-note ai-privacy-note"><ShieldCheck size={18} /><span>{t('receipt.privacy')}</span></div>
        <div className="modal-actions"><Button onClick={onBackToManual}>{t('common.cancel')}</Button><Button variant="primary" onClick={() => cameraInput.current?.click()}>{t('receipt.takePhoto')}</Button></div>
      </div>
    )
  }

  // Review, assignment, and confirmation are reachable only after a draft is set.
  const activeDraft = draft!
  const activeReconciliation = reconciliation!

  if (step === 'review') {
    return (
      <div className="receipt-flow receipt-review">
        <div className="receipt-step-intro">
          <span><Sparkles size={22} /></span>
          <div><h3>{t('receipt.reviewTitle')}</h3><p>{t('receipt.reviewHelp')}</p></div>
        </div>
        <section className="receipt-review-section">
          <header><h4>{t('receipt.items')}</h4><strong>{money(activeReconciliation.itemsCents / 100, activityCurrencyCode, locale)}</strong></header>
          <div className="receipt-review-list">
            {activeDraft.items.map(item => {
              const expanded = expandedItemId === item.id
              return (
                <article className={`receipt-line${item.confidence === 'low' ? ' receipt-line--check' : ''}`} key={item.id}>
                  <div className="receipt-line-main">
                    <span className="receipt-line-index">{item.quantity > 1 ? item.quantity : <ReceiptText size={15} />}</span>
                    <input aria-label={t('receipt.itemName')} value={item.name} onChange={event => updateItem(item.id, current => ({ ...current, name: event.target.value }))} />
                    <span className="receipt-money-input"><i>{currencySymbol(activityCurrencyCode, locale)}</i><ReceiptMoneyInput ariaLabel={t('receipt.itemAmount', { name: item.name })} min={0} valueCents={item.totalCents} onValueChange={value => updateItem(item.id, current => ({ ...current, totalCents: centsFromInput(value) }))} /></span>
                    {item.details.length || item.sourceLines.length ? <button type="button" className={`receipt-detail-toggle${expanded ? ' is-open' : ''}`} aria-label={t(expanded ? 'receipt.hideDetails' : 'receipt.showDetails', { name: item.name })} onClick={() => setExpandedItemId(expanded ? null : item.id)}><ChevronDown size={17} /></button> : null}
                  </div>
                  {expanded ? <div className="receipt-line-details">{item.details.map((detail, index) => <span key={`${detail.kind}-${index}`}><b>•</b>{detail.label}{detail.amountCents === null ? null : <em>{money(detail.amountCents / 100, activityCurrencyCode, locale)}</em>}</span>)}{item.sourceLines.map((line, index) => <small key={`${line}-${index}`}>{line}</small>)}</div> : null}
                </article>
              )
            })}
          </div>
        </section>
        {activeDraft.charges.length ? <section className="receipt-review-section">
          <header><h4>{t('receipt.charges')}</h4><strong>{money(activeReconciliation.chargesCents / 100, activityCurrencyCode, locale)}</strong></header>
          <div className="receipt-charge-list">
            {activeDraft.charges.map(charge => <label key={charge.id}><span>{charge.label}{charge.rateBasisPoints === null ? null : <small>{charge.rateBasisPoints / 100}%</small>}</span><span className="receipt-money-input"><i>{currencySymbol(activityCurrencyCode, locale)}</i><ReceiptMoneyInput ariaLabel={t('receipt.chargeAmount', { name: charge.label })} valueCents={charge.amountCents} onValueChange={value => updateCharge(charge.id, Math.round(Number(value || 0) * 100))} /></span></label>)}
          </div>
        </section> : null}
        <section className={`receipt-totals${activeReconciliation.matches ? '' : ' receipt-totals--mismatch'}`}>
          <label><span>{t('receipt.subtotal')}</span><span className="receipt-money-input"><i>{currencySymbol(activityCurrencyCode, locale)}</i><ReceiptMoneyInput ariaLabel={t('receipt.subtotal')} min={0} valueCents={activeDraft.subtotalCents} onValueChange={value => setDraft(current => ({ ...current!, subtotalCents: centsFromInput(value) }))} /></span></label>
          <label><span>{t('receipt.total')}</span><span className="receipt-money-input"><i>{currencySymbol(activityCurrencyCode, locale)}</i><ReceiptMoneyInput ariaLabel={t('receipt.total')} min={0} valueCents={activeDraft.totalCents} onValueChange={value => setDraft(current => ({ ...current!, totalCents: centsFromInput(value) }))} /></span></label>
          <p><span>{t('receipt.calculated')}</span><strong>{money(activeReconciliation.calculatedTotalCents / 100, activityCurrencyCode, locale)}</strong></p>
        </section>
        {!activeReconciliation.matches ? <div className="receipt-reconciliation" role="alert">
          {activeReconciliation.subtotalDifferenceCents !== 0 ? <div className="receipt-reconciliation-issue">
            <AlertCircle size={18} />
            <span>
              <b>{t(activeReconciliation.subtotalDifferenceCents > 0 ? 'receipt.itemsShort' : 'receipt.itemsOver', {
                amount: money(Math.abs(activeReconciliation.subtotalDifferenceCents) / 100, activityCurrencyCode, locale),
              })}</b>
              <small>{t(activeReconciliation.subtotalDifferenceCents > 0 ? 'receipt.itemsShortHelp' : 'receipt.itemsOverHelp')}</small>
            </span>
            {activeReconciliation.subtotalDifferenceCents > 0 && activeDraft.items.length < MAX_RECEIPT_ITEMS ? <Button onClick={addMissingItem}>{t('receipt.addMissingItem', {
              amount: money(activeReconciliation.subtotalDifferenceCents / 100, activityCurrencyCode, locale),
            })}</Button> : null}
          </div> : null}
          {activeReconciliation.chargeDifferenceCents !== 0 ? <div className="receipt-reconciliation-issue">
            <AlertCircle size={18} />
            <span>
              <b>{t(activeReconciliation.chargeDifferenceCents > 0 ? 'receipt.chargesShort' : 'receipt.chargesOver', {
                amount: money(Math.abs(activeReconciliation.chargeDifferenceCents) / 100, activityCurrencyCode, locale),
              })}</b>
              <small>{t(activeReconciliation.chargeDifferenceCents > 0 ? 'receipt.chargesShortHelp' : 'receipt.chargesOverHelp')}</small>
            </span>
            {activeReconciliation.chargeDifferenceCents > 0 && activeDraft.charges.length < MAX_RECEIPT_CHARGES ? <Button onClick={addMissingCharge}>{t('receipt.addMissingCharge', {
              amount: money(activeReconciliation.chargeDifferenceCents / 100, activityCurrencyCode, locale),
            })}</Button> : null}
          </div> : null}
        </div> : null}
        {!currencyMatches ? <div className="receipt-warning" role="alert"><AlertCircle size={18} />{t('receipt.currencyMismatch', { receiptCurrency: currencyLabel(activeDraft.currency!, locale), activityCurrency: currencyLabel(activityCurrencyCode, locale) })}</div> : null}
        {activeDraft.unresolvedLines.length ? <div className="receipt-unresolved"><b>{t('receipt.unresolved')}</b>{activeDraft.unresolvedLines.map(line => <small key={line}>{line}</small>)}<label><input type="checkbox" checked={unresolvedConfirmed} onChange={event => setUnresolvedConfirmed(event.target.checked)} />{t('receipt.unresolvedConfirm')}</label></div> : null}
        <div className="modal-actions receipt-modal-actions"><Button onClick={resetCapture}><ArrowLeft size={16} />{t('receipt.tryAgain')}</Button><Button variant="primary" disabled={!reviewReady} onClick={() => { setAssignmentIndex(0); setStep('assign') }}>{t('receipt.continueAssign')}</Button></div>
      </div>
    )
  }

  if (step === 'assign') {
    const item = activeDraft.items[assignmentIndex]
    const selected = assignments[item.id] ?? []
    const isLastItem = assignmentIndex === activeDraft.items.length - 1
    return (
      <div className="receipt-flow receipt-assign">
        <div className="receipt-step-intro"><span><Users size={22} /></span><div><h3>{t('receipt.assignTitle')}</h3><p>{t('receipt.assignHelp')}</p></div></div>
        <div className="receipt-assignment-progress">
          <span>{t('receipt.assignmentProgress', { current: assignmentIndex + 1, total: activeDraft.items.length })}</span>
          <progress max={activeDraft.items.length} value={assignmentIndex + 1} />
        </div>
        <div className="receipt-assignment-list">
          <article key={item.id}>
            <header><span><b>{item.name}</b>{item.quantity > 1 ? <small>{t('receipt.quantity', { quantity: item.quantity })}</small> : null}</span><strong>{money(item.totalCents / 100, activityCurrencyCode, locale)}</strong></header>
            <div className="receipt-assignment-shortcuts">
              <button type="button" className={selected.length === members.length ? 'is-selected' : ''} onClick={() => assignEveryone(item.id)}>{t('receipt.everyone')}</button>
              <button type="button" disabled={!selected.length} onClick={() => clearAssignment(item.id)}>{t('receipt.clear')}</button>
            </div>
            <div className="receipt-member-grid">{members.map((member, index) => <button key={`${member.id}-${index}`} type="button" className={selected.includes(member.id) ? 'is-selected' : ''} aria-pressed={selected.includes(member.id)} aria-label={t('receipt.assignMember', { item: item.name, name: member.name })} onClick={() => toggleAssignment(item.id, member.id)}><Avatar member={member} size="sm" /><span>{member.name}</span>{selected.includes(member.id) ? <Check size={14} /> : null}</button>)}</div>
            <small className={selected.length ? '' : 'is-required'}>{selected.length ? t('receipt.assignedCount', { count: selected.length }) : t('receipt.assignRequired')}</small>
          </article>
        </div>
        <div className="modal-actions receipt-modal-actions">
          <Button onClick={() => assignmentIndex > 0 ? setAssignmentIndex(current => current - 1) : setStep('review')}><ArrowLeft size={16} />{t(assignmentIndex > 0 ? 'receipt.previousDish' : 'receipt.backToReceipt')}</Button>
          <Button variant="primary" disabled={!selected.length || (isLastItem && (!allItemsAssigned || !split))} onClick={() => isLastItem ? setStep('confirm') : setAssignmentIndex(current => current + 1)}>{t(isLastItem ? 'receipt.continueReview' : 'receipt.nextDish')}</Button>
        </div>
      </div>
    )
  }

  const chargedTipIncluded = activeDraft.charges.some(charge => charge.type === 'tip')
  const confirmedSplit = split!
  const participantTotals = confirmedSplit.members.filter(member => member.totalCents > 0)
  return (
    <div className="receipt-flow receipt-confirm">
      <div className="receipt-step-intro"><span><Check size={22} /></span><div><h3>{t('receipt.confirmTitle')}</h3><p>{t('receipt.confirmHelp')}</p></div></div>
      <div className="form-grid receipt-confirm-fields">
        <label>{t('receipt.description')}<input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
        <label>{t('receipt.paidBy')}<SelectMenu value={payerId} options={payerOptions} onChange={setPayerId} ariaLabel={t('receipt.paidBy')} menuLabel={t('receipt.paidBy')} /></label>
      </div>
      {charges.length ? <section className="receipt-charge-methods"><h4>{t('receipt.extraCharges')}</h4>{charges.map(charge => <label key={charge.id}><span><b>{charge.label}</b><small>{money(charge.amountCents / 100, activityCurrencyCode, locale)}</small></span><SelectMenu value={charge.allocationMethod} options={chargeMethodOptions} onChange={method => setChargeMethod(charge.id, method)} ariaLabel={`${charge.label} ${t('receipt.extraCharges')}`} menuLabel={t('receipt.extraCharges')} /></label>)}</section> : null}
      <section className="receipt-tip-field"><label><span><b>{t('receipt.tip')}</b><small>{chargedTipIncluded ? t('receipt.tipAlreadyIncluded') : t('receipt.tipHelp')}</small></span><span className="receipt-tip-input"><input aria-label={t('receipt.tipPercent')} type="number" inputMode="decimal" min="0" max="100" step="0.5" disabled={chargedTipIncluded} value={tipPercent} onChange={event => setTipPercent(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} onFocus={selectInputContents} /><i>%</i></span></label></section>
      <section className={`receipt-person-totals${participantTotals.length > 4 ? ' receipt-person-totals--scrollable' : ''}`}>
        {participantTotals.map(total => {
          const member = members.find(candidate => candidate.id === total.memberId)!
          return <article key={member.id}><header><span><Avatar member={member} size="sm" /><b>{member.name}</b></span><strong>{money(total.totalCents / 100, activityCurrencyCode, locale)}</strong></header><p><span>{t('receipt.food')} <b>{money(total.foodCents / 100, activityCurrencyCode, locale)}</b></span><span>{t('receipt.taxAndCharges')} <b>{money(total.chargeCents / 100, activityCurrencyCode, locale)}</b></span></p></article>
        })}
        <footer><span>{t('receipt.personTotal')}</span><strong>{money(confirmedSplit.totalCents / 100, activityCurrencyCode, locale)}</strong></footer>
      </section>
      <div className="split-note receipt-ai-note"><ShieldCheck size={18} /><span>{t('receipt.aiReviewNote')}</span></div>
      <div className="modal-actions receipt-modal-actions"><Button onClick={() => setStep('assign')}><ArrowLeft size={16} />{t('receipt.backToDishes')}</Button><Button variant="primary" disabled={!split || !title.trim() || !payerId || saving} onClick={saveReceipt}>{t('receipt.save')}</Button></div>
    </div>
  )
}

export const receiptSplitTestables = { amountInput, buildTipCharge, centsFromInput, chargeSettings }
