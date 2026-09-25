import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Check,
  ChevronRight,
  CircleDollarSign,
  Ellipsis,
  Plus,
  Radio,
  ReceiptText,
  Share2,
  Tag,
  Trash2,
} from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { Button, IconButton } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
import { activityCurrency, type CurrencyCode } from '../../domain/currency'
import { calculateMemberBalance, calculateSettlements, getSettlementRecipientId, isSettlementPayment, memberExpenseNet, money, spendingExpenses } from '../../domain/expenses'
import { activeActivityMembers, isInactiveMember } from '../../domain/memberRemoval'
import { CURRENT_USER } from '../../domain/members'
import type { ActivityGroup, Expense, Member, Settlement } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'
import { formatLocalizedDay, formatLocalizedList, localDayKey } from '../../i18n/localization'
import { ShareActivityMenu } from '../sharing/ShareActivityMenu'
import { ActivityCurrencyControl } from './ActivityCurrencyControl'
import { ActivityIdentityControl } from './ActivityIdentityControl'
import { categoryLabel, expenseCategory, type CategoryChange } from '../../domain/categories'
import { CategorySummary } from '../categories/CategorySummary'
import { CategoryManager } from '../categories/CategoryManager'
import './dashboard.css'
import './expenseList.css'

type DashboardView = 'expenses' | 'balances' | 'categories'

/** The viewer's own label is a name only when they chose to see the activity as a named member. */
function useViewerNaming(currentUserLabel?: string) {
  const { t } = useLocalization()
  const named = Boolean(currentUserLabel && currentUserLabel !== 'You' && currentUserLabel !== t('common.you'))
  return { named, label: currentUserLabel ?? t('common.you') }
}

function AvatarStack({ members, limit = 5 }: { members: Member[]; limit?: number }) {
  const hidden = members.length - limit
  return (
    <span className="avatar-stack" aria-hidden="true">
      {members.slice(0, limit).map(member => <Avatar key={member.id} member={member} size="sm" />)}
      {hidden > 0 ? <span className="avatar-stack-more">+{hidden}</span> : null}
    </span>
  )
}

export function ActivitySummary({ expenses, members = [], currency = 'USD', currentMemberId = 'me', currentUserLabel, onSettle }: {
  expenses: Expense[]
  members?: Member[]
  currency?: CurrencyCode
  currentMemberId?: string | null
  currentUserLabel?: string
  /** Receives the suggested payments between the viewer and other people. */
  onSettle?: (settlements: Settlement[]) => void
}) {
  const { locale, t } = useLocalization()
  const viewer = useViewerNaming(currentUserLabel)
  const { balance, paid, share, total } = useMemo(() => {
    let total = 0
    let paid = 0
    let share = 0
    for (const expense of spendingExpenses(expenses)) {
      total += expense.amount
      if (currentMemberId && expense.payerId === currentMemberId) paid += expense.amount
      if (currentMemberId) share += expense.shares[currentMemberId] ?? 0
    }
    return {
      balance: currentMemberId ? Math.round(calculateMemberBalance(currentMemberId, expenses) * 100) / 100 : 0,
      paid,
      share,
      total,
    }
  }, [currentMemberId, expenses])
  const settlements = useMemo(() => calculateSettlements(members, expenses), [expenses, members])

  const balanceLabel = !currentMemberId
    ? t('activityIdentity.choose')
    : viewer.named
    ? t(balance > 0 ? 'dashboard.memberIsOwed' : balance < 0 ? 'dashboard.memberOwesBalance' : 'dashboard.memberBalance', { name: viewer.label })
    : t(balance > 0 ? 'dashboard.youAreOwed' : balance < 0 ? 'dashboard.youOwe' : 'dashboard.yourBalance')
  const balanceTone = !currentMemberId ? '' : balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'settled'
  const incoming = settlements.filter(settlement => settlement.to.id === currentMemberId)
  const outgoing = settlements.filter(settlement => settlement.from.id === currentMemberId)
  const counterparts = incoming.length ? incoming.map(settlement => settlement.from) : outgoing.map(settlement => settlement.to)
  const names = formatLocalizedList(counterparts.map(member => member.name), locale)
  const settleCopy = incoming.length
    ? t(viewer.named
      ? counterparts.length === 1 ? 'dashboard.oweMemberSummaryOne' : 'dashboard.oweMemberSummary'
      : counterparts.length === 1 ? 'dashboard.oweYouSummaryOne' : 'dashboard.oweYouSummary', { names, name: viewer.label })
    : t(viewer.named ? 'dashboard.memberOwesSummary' : 'dashboard.youOweSummary', { names, name: viewer.label })

  return (
    <section className="balance-card" aria-label={t('dashboard.summaryLabel')}>
      <div className="balance-card-main">
        <div className="balance-card-balance">
          <span>{balanceLabel}</span>
          <strong className={balanceTone}>{currentMemberId ? money(balance, currency, locale) : '—'}</strong>
        </div>
        <dl className="balance-card-stats">
          <div><dt>{t('dashboard.totalSpent')}</dt><dd>{money(total, currency, locale)}</dd></div>
          <div><dt>{currentMemberId ? t('dashboard.paid', { name: viewer.label }) : t('activityIdentity.choose')}</dt><dd>{currentMemberId ? money(paid, currency, locale) : '—'}</dd></div>
          <div><dt>{viewer.named ? t('dashboard.memberShare', { name: viewer.label }) : t('dashboard.yourShare')}</dt><dd>{currentMemberId ? money(share, currency, locale) : '—'}</dd></div>
        </dl>
      </div>
      {onSettle && counterparts.length ? (
        <button type="button" className="balance-card-settle" onClick={() => onSettle(incoming.length ? incoming : outgoing)}>
          <AvatarStack members={counterparts} />
          <span className="balance-card-settle-copy">{settleCopy}</span>
          <span className={`balance-card-settle-action${incoming.length ? ' positive' : ''}`}>{t('dashboard.settleUp')}<ChevronRight size={16} aria-hidden="true" /></span>
        </button>
      ) : null}
    </section>
  )
}

/** Colors a settlement from the viewer's side: money coming to them, money they pay, or neither. */
function settlementTone(settlement: Settlement, currentMemberId: string | null) {
  if (!currentMemberId) return undefined
  if (settlement.to.id === currentMemberId) return 'settlement-amount--incoming'
  if (settlement.from.id === currentMemberId) return 'settlement-amount--outgoing'
  return undefined
}

export function SettlementDirections({ members, expenses, currency = 'USD', currentMemberId = 'me', currentUserLabel, headingId, highlighted = false, onSettleUp }: { members: Member[]; expenses: Expense[]; currency?: CurrencyCode; currentMemberId?: string | null; currentUserLabel?: string; headingId?: string; highlighted?: boolean; onSettleUp?: (settlement: Settlement) => void }) {
  const { locale, t } = useLocalization()
  const settlements = useMemo(() => calculateSettlements(members, expenses), [expenses, members])
  const currentUserOwes = currentUserLabel && currentUserLabel !== 'You' && currentUserLabel !== t('common.you')
    ? t('dashboard.memberOwes', { name: currentUserLabel })
    : t('dashboard.youOwe')

  return (
    <section className={`content-section settlements-panel${highlighted ? ' settlements-panel--highlighted' : ''}`}>
      <div className="section-heading"><h2 id={headingId} tabIndex={headingId ? -1 : undefined}>{t('dashboard.whoOwes')}</h2><span className="section-meta">{t('dashboard.suggestedSettlements')}</span></div>
      <div className="balance-list">
        {settlements.length ? settlements.map(settlement => (
          <div className="balance-row settlement-row" key={`${settlement.from.id}-${settlement.to.id}`}>
            <span className="settlement-avatars"><Avatar member={settlement.from} size="sm" /><i>→</i><Avatar member={settlement.to} size="sm" /></span>
            <span className="row-copy"><b>{currentMemberId && settlement.from.id === currentMemberId ? `${currentUserOwes} ${settlement.to.name}` : t('dashboard.owesPerson', { from: settlement.from.name, to: settlement.to.name })}</b><small>{t('dashboard.suggestedPayment')}</small></span>
            <span className="settlement-action"><strong className={settlementTone(settlement, currentMemberId)}>{money(settlement.amount, currency, locale)}</strong>{onSettleUp ? <Button className="settle-up-button" onClick={() => onSettleUp(settlement)}>{t('dashboard.settleUp')}</Button> : null}</span>
          </div>
        )) : <div className="all-settled"><span><Check size={18} /></span><div><b>{t('dashboard.everyoneSettled')}</b><p>{t('dashboard.addExpensePrompt')}</p></div></div>}
      </div>
    </section>
  )
}

type ExpenseDay = { key: string; label: string; expenses: Expense[] }

/** Newest day first; expenses without a readable date keep their order at the end. */
function groupExpensesByDay(expenses: Expense[], label: (value: string) => string, unknownLabel: string, timeZone: string): ExpenseDay[] {
  const days = new Map<string, ExpenseDay>()
  const dated = expenses
    .map((expense, index) => ({ expense, index, key: localDayKey(expense.createdAt, timeZone) }))
    .sort((a, b) => a.key === b.key
      ? a.index - b.index
      : a.key === null ? 1 : b.key === null ? -1 : b.key.localeCompare(a.key))
  for (const { expense, key } of dated) {
    const dayKey = key ?? 'unknown'
    const day = days.get(dayKey) ?? { key: dayKey, label: key ? label(expense.createdAt) : unknownLabel, expenses: [] }
    day.expenses.push(expense)
    days.set(dayKey, day)
  }
  return [...days.values()]
}

export function ExpenseList({ expenses, members, group, inactiveMembers = [], currency = 'USD', query, readOnly = false, currentMemberId = null, currentUserLabel, onEditExpense, onDeleteExpense }: {
  group?: ActivityGroup
  currentMemberId?: string | null
  currentUserLabel?: string
  expenses: Expense[]
  members: Member[]
  inactiveMembers?: Member[]
  currency?: CurrencyCode
  query: string
  readOnly?: boolean
  onEditExpense?: (expense: Expense) => void
  onDeleteExpense?: (expense: Expense) => void
}) {
  const { locale, t, timeZone, formatDateTime } = useLocalization()
  const memberMap = useMemo(() => new Map(members.map(member => [member.id, member])), [members])
  const normalizedQuery = query.toLowerCase()
  const namedViewer = useViewerNaming(currentUserLabel).named
  const rowIdPrefix = useId()
  const visible = useMemo(() => expenses.filter(expense => {
    if (expense.title.toLowerCase().includes(normalizedQuery)) return true
    if (!isSettlementPayment(expense)) return false
    const recipientId = getSettlementRecipientId(expense)
    return [memberMap.get(expense.payerId)?.name, recipientId ? memberMap.get(recipientId)?.name : undefined]
      .some(name => name?.toLowerCase().includes(normalizedQuery))
  }), [expenses, memberMap, normalizedQuery])
  const days = useMemo(
    () => groupExpensesByDay(visible, value => formatLocalizedDay(value, locale, timeZone), t('dashboard.dateUnknown'), timeZone),
    [locale, t, timeZone, visible],
  )

  const renderExpense = (expense: Expense) => {
    const payer = memberMap.get(expense.payerId) ?? CURRENT_USER
    const settlementRecipientId = getSettlementRecipientId(expense)
    const settlementRecipient = settlementRecipientId ? memberMap.get(settlementRecipientId) : undefined
    const settlementPayment = isSettlementPayment(expense)
    const removedNames = inactiveMembers.filter(member => expense.payerId === member.id || Object.hasOwn(expense.shares, member.id)).map(member => member.name)
    const participantCount = Object.keys(expense.shares).length
    const storedTimestamp = expense.updatedAt ?? expense.createdAt
    const localizedTimestamp = formatDateTime(storedTimestamp)
    const timestampLabel = localizedTimestamp
      ? t(expense.updatedAt ? 'expense.editedAt' : 'expense.createdAt', { date: localizedTimestamp })
      : storedTimestamp === 'Just now' ? t('expense.timeUnavailable') : storedTimestamp
    const unknown = t('common.unknown')
    const category = group && !settlementPayment ? expenseCategory(group, expense) : null
    const viewerNet = currentMemberId && !settlementPayment ? memberExpenseNet(currentMemberId, expense) : 0
    const viewerShareKey = viewerNet > 0
      ? namedViewer ? 'dashboard.memberLent' : 'dashboard.youLent'
      : namedViewer ? 'dashboard.memberBorrowed' : 'dashboard.youBorrowed'
    const detailsId = `${rowIdPrefix}-${expense.id}-details`
    const amountId = `${rowIdPrefix}-${expense.id}-amount`
    const content = <>
      <span className={`expense-icon${settlementPayment ? ' settlement-icon' : ''}`}>{settlementPayment ? <CircleDollarSign size={18} /> : <ReceiptText size={18} />}</span>
      <span className="row-copy">
        <b>{settlementPayment ? t('dashboard.paidPerson', { payer: payer.name, recipient: settlementRecipient?.name ?? unknown }) : expense.title}</b>
        <span className="expense-meta-line">
          <small id={detailsId}>{settlementPayment ? t('dashboard.settlementPayment') : <>{t('dashboard.paidLabel', { payer: payer.name })}<i /><span className="expense-split-method">{t(expense.splitMethod === 'equal' ? 'dashboard.splitEqually' : 'dashboard.exactSplit')} · </span>{participantCount} {t(participantCount === 1 ? 'common.person' : 'common.people')}</>}</small>
          {category?.id ? <span className="expense-category-label" style={{ '--category-color': category.color } as CSSProperties}><span className="category-dot" aria-hidden="true" />{categoryLabel(category, locale)}</span> : null}
          {expense.updatedAt ? <span className="expense-edited">{t('dashboard.edited')}</span> : null}
        </span>
        {removedNames.length && !settlementPayment ? <small>{t('members.historyIncludes', { names: removedNames.join(', ') })}</small> : null}
      </span>
      <span className="expense-amount" id={amountId}><b>{money(expense.amount, currency, locale)}</b>{viewerNet ? <small className={`expense-share expense-share--${viewerNet > 0 ? 'lent' : 'owe'}`}>{t(viewerShareKey, { name: currentUserLabel ?? '', amount: money(viewerNet, currency, locale) })}</small> : null}</span>
    </>
    const rowClass = `activity-row expense-entry${settlementPayment ? ' settlement-payment-row' : ''}`
    if (!readOnly && !settlementPayment && onEditExpense) {
      return <button type="button" className={`${rowClass} expense-entry--editable`} key={expense.id} title={timestampLabel} aria-label={t('dashboard.editExpense', { title: expense.title })} aria-describedby={`${detailsId} ${amountId}`} onClick={() => onEditExpense(expense)}>{content}</button>
    }
    return (
      <div className={rowClass} key={expense.id} title={timestampLabel}>
        {content}
        {!readOnly && settlementPayment && onDeleteExpense ? <IconButton className="expense-delete" tone="danger" label={t('dashboard.deletePayment', { payer: payer.name, recipient: settlementRecipient?.name ?? unknown })} title={t('dashboard.deleteSettlementTitle')} onClick={() => onDeleteExpense(expense)}><Trash2 size={16} /></IconButton> : null}
      </div>
    )
  }

  return (
    <section className="content-section activity-section">
      <div className="section-heading"><h2>{t('dashboard.expenses')}</h2><span className="section-meta">{visible.length} {t(visible.length === 1 ? 'dashboard.entry' : 'dashboard.entries')}</span></div>
      <div className="activity-list">
        {days.length ? days.map(day => (
          <div className="expense-day" key={day.key}>
            <h3 className="expense-day-heading">{day.label}</h3>
            {day.expenses.map(renderExpense)}
          </div>
        )) : <div className="empty-state"><ReceiptText size={22} /><p>{t(query ? 'dashboard.noMatches' : 'dashboard.noExpenses')}</p></div>}
      </div>
    </section>
  )
}

export function MembersRail({ members, group, expenses = [], currency = 'USD', currentMemberId = 'me', readOnly = false, onAddFriend, onRemoveFriend, onRestoreFriend }: { members: Member[]; group?: ActivityGroup; expenses?: Expense[]; currency?: CurrencyCode; currentMemberId?: string | null; readOnly?: boolean; onAddFriend?: () => void; onRemoveFriend?: (member: Member) => void; onRestoreFriend?: (member: Member) => void }) {
  const { locale, t } = useLocalization()
  const active = group ? activeActivityMembers(group, members) : members
  const inactive = group ? members.filter(member => isInactiveMember(group, member.id)) : []
  const balances = new Map(active.map(member => [member.id, Math.round(calculateMemberBalance(member.id, expenses) * 100) / 100]))
  const largest = Math.max(0, ...[...balances.values()].map(Math.abs))
  return (
    <section className="members-panel">
      <div className="rail-heading"><h2>{t('dashboard.people')}</h2><span>{active.length}</span></div>
      <div className="member-list">{active.map(member => {
        const balance = balances.get(member.id)!
        return <div className="member-row" key={member.id}>
          <Avatar member={member} size="sm" />
          <span className="member-copy">
            <b>{member.name}{member.id === currentMemberId ? <span className="member-identity-indicator"><Check size={14} aria-label={t('dashboard.currentIdentity')} /></span> : null}</b>
            {expenses.length ? <span className="member-balance-bar" aria-hidden="true"><span className={balance > 0 ? 'positive-bar' : balance < 0 ? 'negative-bar' : ''} style={{ width: `${largest ? Math.abs(balance) / largest * 100 : 0}%` }} /></span> : null}
          </span>
          {expenses.length ? <span className={`member-balance ${balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'settled'}`}>{balance > 0 ? '+' : balance < 0 ? '−' : ''}{money(balance, currency, locale)}</span> : null}
          {!readOnly && onRemoveFriend ? member.id === 'me'
            ? <span className="member-action-placeholder" aria-hidden="true" />
            : <IconButton tone="danger" label={t('removeFriend.label', { name: member.name })} onClick={() => onRemoveFriend(member)}><Trash2 size={16} /></IconButton> : null}
        </div>
      })}</div>
      {readOnly ? null : <Button className="add-friend-button" onClick={onAddFriend}><Plus size={16} />{t('dashboard.addFriend')}</Button>}
      {inactive.length ? <details className="inactive-members"><summary>{t('members.removedCount', { count: inactive.length })}</summary>
        <p>{t('members.restoreHelp')}</p>
        {inactive.map(member => <div className="member-row" key={member.id}><Avatar member={member} size="sm" /><b>{member.name}</b>
          {!readOnly && onRestoreFriend ? <Button variant="ghost" aria-label={t('members.restoreName', { name: member.name })} onClick={() => onRestoreFriend(member)}>{t('members.restore')}</Button> : null}
        </div>)}
      </details> : null}
    </section>
  )
}

export function GroupDashboard({ group, members, expenses, query, activityFeedback, readOnly = false, readOnlyLabel, currentMemberId = 'me', currentUserLabel = 'You', statusLabel, onCurrentMemberChange, onCurrencyChange, onShareSummary, onExportData, onShareQr, onShareLive, onCopyShareLink, onEndLive, onAddFriend, onRemoveFriend, onRestoreFriend, onAddExpense, onSettleUp, onEditExpense, onDeleteExpense, onCategoriesChange, onCategorySummaryOpen }: {
  onCategorySummaryOpen?: () => void
  onCategoriesChange?: (change: CategoryChange) => Promise<boolean>
  group: ActivityGroup
  members: Member[]
  expenses: Expense[]
  query: string
  activityFeedback: string | null
  readOnly?: boolean
  readOnlyLabel?: string
  currentMemberId?: string | null
  currentUserLabel?: string
  statusLabel?: string
  onCurrentMemberChange?: (memberId: string) => void
  onCurrencyChange?: (currency: CurrencyCode) => void
  onShareSummary?: () => void
  onExportData?: () => void
  onShareQr?: () => void
  onShareLive?: () => void
  onCopyShareLink?: () => void
  onEndLive?: () => void
  onAddFriend?: () => void
  onRemoveFriend?: (member: Member) => void
  onRestoreFriend?: (member: Member) => void
  onAddExpense?: () => void
  onSettleUp?: (settlement: Settlement) => void
  onEditExpense?: (expense: Expense) => void
  onDeleteExpense?: (expense: Expense) => void
}) {
  const { locale, t } = useLocalization()
  const [shareMenuOpen, setShareMenuOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [view, setView] = useState<DashboardView>('expenses')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [manageCategories, setManageCategories] = useState(false)
  const [balancesFocusRequest, setBalancesFocusRequest] = useState(0)
  const balancesTab = useRef<HTMLButtonElement>(null)
  const balancesHeadingId = useId()
  const currency = activityCurrency(group)
  const active = activeActivityMembers(group, members)
  const activeCount = active.length
  const historyMembers = members.map(member => isInactiveMember(group, member.id)
    ? { ...member, name: t('members.inactiveName', { name: member.name }) } : member)
  const inactiveMembers = members.filter(member => isInactiveMember(group, member.id))
  const hasExpenses = expenses.length > 0
  const canShare = Boolean(onShareSummary || onExportData || onShareQr || onShareLive || onCopyShareLink)
  const canManageCategories = !readOnly && Boolean(onCategoriesChange)
  const showPrimaryActions = !readOnly && (canShare || (hasExpenses && Boolean(onAddExpense)))

  useEffect(() => {
    if (balancesFocusRequest) document.getElementById(balancesHeadingId)!.focus()
  }, [balancesFocusRequest, balancesHeadingId])

  const selectView = (next: DashboardView) => {
    if (next === 'categories' && view !== 'categories') onCategorySummaryOpen?.()
    if (next !== 'categories') setSelectedCategory(null)
    setView(next)
  }
  // On wide screens balances sit beside the list and the Balances tab is hidden, so the panel is highlighted instead.
  const showBalances = () => {
    if (getComputedStyle(balancesTab.current!).display !== 'none') selectView('balances')
    setBalancesFocusRequest(request => request + 1)
  }
  const settleFromSummary = (viewerSettlements: Settlement[]) => {
    if (viewerSettlements.length === 1 && onSettleUp && !readOnly) onSettleUp(viewerSettlements[0])
    else showBalances()
  }
  const openCategoryManager = () => {
    setOptionsOpen(false)
    setManageCategories(true)
  }

  const tab = (id: DashboardView, label: string) => (
    <button
      ref={id === 'balances' ? balancesTab : undefined}
      type="button"
      role="tab"
      className={`dashboard-tab dashboard-tab--${id}`}
      aria-selected={view === id}
      onClick={() => selectView(id)}
    >{label}</button>
  )

  return (
    <main className={`dashboard dashboard--view-${view}${showPrimaryActions ? ' dashboard--with-actions' : ''}`}>
      <div className="main-column">
        <header className="group-welcome">
          <div className="group-title">
            <h1>{group.name}</h1>
            <div className="group-meta">
              <AvatarStack members={active} />
              <p>{t('dashboard.sharing', { count: activeCount, unit: t(activeCount === 1 ? 'common.person' : 'common.people') })}</p>
              {!readOnly && onAddFriend ? <button type="button" className="add-person-chip" aria-label={t('dashboard.addFriend')} onClick={onAddFriend}><Plus size={14} aria-hidden="true" />{t('dashboard.addPerson')}</button> : null}
            </div>
          </div>
          <div className="group-share">
            <div className="group-actions">
              <div className="group-context-actions">
                {statusLabel ? <span className="read-only-badge live-badge"><Radio size={14} />{statusLabel}</span> : null}
                {onCurrentMemberChange ? <ActivityIdentityControl memberId={currentMemberId} members={historyMembers} onChange={onCurrentMemberChange} /> : null}
                {readOnly ? <span className="read-only-badge">{readOnlyLabel ?? t('dashboard.readOnly')}</span> : null}
                <IconButton className="activity-options-button" label={t('dashboard.activityOptions')} onClick={() => setOptionsOpen(true)}><Ellipsis size={20} /></IconButton>
              </div>
              {showPrimaryActions ? (
                <div className="group-primary-actions">
                  {canShare ? <Button className="share-button" onClick={() => setShareMenuOpen(true)}><Share2 size={16} />{t('dashboard.share')}</Button> : null}
                  {hasExpenses && onAddExpense ? <Button variant="primary" onClick={onAddExpense}><Plus size={17} />{t('dashboard.addExpense')}</Button> : null}
                </div>
              ) : null}
            </div>
            {activityFeedback ? <span className="activity-feedback" role="status">{activityFeedback}</span> : null}
          </div>
        </header>
        {hasExpenses ? <ActivitySummary expenses={expenses} members={historyMembers} currency={currency} currentMemberId={currentMemberId} currentUserLabel={currentUserLabel} onSettle={settleFromSummary} /> : null}
        <div className="dashboard-tabs" role="tablist" aria-label={t('dashboard.viewTabs')}>
          {tab('expenses', t('dashboard.expenses'))}
          {tab('balances', t('dashboard.balancesTab'))}
          {tab('categories', t('categories.summary'))}
        </div>
        <div className="dashboard-panel">
          {view === 'categories' ? <CategorySummary group={group} expenses={expenses} selected={selectedCategory} onSelect={setSelectedCategory} onManage={canManageCategories ? () => setManageCategories(true) : undefined} /> : null}
          {hasExpenses ? (
            <ExpenseList group={group} currentMemberId={currentMemberId} currentUserLabel={currentUserLabel} expenses={view === 'categories' ? expenses.filter(expense => !isSettlementPayment(expense) && (selectedCategory === null || expenseCategory(group, expense).id === selectedCategory)) : expenses} members={historyMembers} inactiveMembers={inactiveMembers} currency={currency} query={query} readOnly={readOnly} onEditExpense={onEditExpense} onDeleteExpense={onDeleteExpense} />
          ) : view === 'categories' ? null : (
            <section className="activity-empty">
              <span><ReceiptText size={25} /></span>
              <h2>{t('dashboard.emptyTitle')}</h2>
              <p>{t('dashboard.emptyText')}</p>
              {!readOnly && onAddExpense ? <Button variant="primary" onClick={onAddExpense}><Plus size={17} />{t('dashboard.addExpense')}</Button> : null}
            </section>
          )}
        </div>
      </div>
      <aside className="right-rail activity-rail">
        <SettlementDirections key={balancesFocusRequest} highlighted={balancesFocusRequest > 0} members={historyMembers} expenses={expenses} currency={currency} currentMemberId={currentMemberId} currentUserLabel={currentUserLabel} headingId={balancesHeadingId} onSettleUp={readOnly ? undefined : onSettleUp} />
        <MembersRail group={group} members={members} expenses={expenses} currency={currency} currentMemberId={currentMemberId} readOnly={readOnly} onAddFriend={onAddFriend} onRemoveFriend={onRemoveFriend} onRestoreFriend={onRestoreFriend} />
      </aside>
      {optionsOpen ? (
        <ModalShell eyebrow={group.name} title={t('dashboard.activityOptions')} description={t('dashboard.activityOptionsHelp')} onClose={() => setOptionsOpen(false)} mobilePlacement="center">
          <div className="activity-options">
            <div className="activity-options-field"><span>{t('group.currency')}</span><ActivityCurrencyControl currency={currency} locale={locale} readOnly={readOnly} onChange={onCurrencyChange} /></div>
            {canManageCategories ? <Button onClick={openCategoryManager}><Tag size={16} />{t('categories.manage')}</Button> : null}
          </div>
        </ModalShell>
      ) : null}
      {manageCategories && onCategoriesChange ? <CategoryManager group={group} expenses={expenses} onChange={async change => {
        const saved = await onCategoriesChange(change)
        if (saved && change.kind === 'delete' && selectedCategory === change.id) setSelectedCategory(null)
        return saved
      }} onClose={() => setManageCategories(false)} /> : null}
      {shareMenuOpen ? <ShareActivityMenu
        groupName={group.name}
        live={Boolean(onCopyShareLink && !onShareLive)}
        onClose={() => setShareMenuOpen(false)}
        onCollaborateLive={onShareLive}
        onCopyLink={onCopyShareLink}
        onShowQr={onShareQr}
        onShareSummary={onShareSummary}
        onExportData={onExportData}
        onEndLive={onEndLive}
      /> : null}
    </main>
  )
}
