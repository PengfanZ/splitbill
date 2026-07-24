import { useMemo } from 'react'
import {
  Check,
  CircleDollarSign,
  Pencil,
  Plus,
  QrCode,
  Radio,
  ReceiptText,
  Share2,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { Avatar } from '../../components/AppShell'
import { activityCurrency, currencySymbol, SUPPORTED_CURRENCIES, type CurrencyCode } from '../../domain/currency'
import { calculateMemberBalance, calculateSettlements, getSettlementRecipientId, isSettlementPayment, money, spendingExpenses } from '../../domain/expenses'
import { CURRENT_USER } from '../../domain/members'
import type { ActivityGroup, Expense, Member, Settlement } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'

export function ActivitySummary({ expenses, currency = 'USD', currentUserLabel }: { expenses: Expense[]; currency?: CurrencyCode; currentUserLabel?: string }) {
  const { locale, t } = useLocalization()
  const userLabel = currentUserLabel ?? t('common.you')
  const spending = spendingExpenses(expenses)
  const total = spending.reduce((sum, expense) => sum + expense.amount, 0)
  const paid = spending.reduce((sum, expense) => sum + (expense.payerId === 'me' ? expense.amount : 0), 0)
  const balance = calculateMemberBalance('me', expenses)
  const balanceLabel = currentUserLabel && currentUserLabel !== 'You' && currentUserLabel !== t('common.you')
    ? t('dashboard.memberBalance', { name: currentUserLabel })
    : t('dashboard.yourBalance')

  return (
    <div className="summary" aria-label={t('dashboard.summaryLabel')}>
      <div aria-label={t('dashboard.totalSpent')}><span>{t('dashboard.totalSpent')}</span><strong>{money(total, currency, locale)}</strong></div>
      <div aria-label={t('dashboard.paid', { name: userLabel })}><span>{t('dashboard.paid', { name: userLabel })}</span><strong>{money(paid, currency, locale)}</strong></div>
      <div aria-label={balanceLabel}><span>{balanceLabel}</span><strong className={balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'settled'}>{balance > 0 ? '+' : balance < 0 ? '−' : ''}{money(balance, currency, locale)}</strong></div>
    </div>
  )
}

export function SettlementDirections({ members, expenses, currency = 'USD', currentUserLabel, onSettleUp }: { members: Member[]; expenses: Expense[]; currency?: CurrencyCode; currentUserLabel?: string; onSettleUp?: (settlement: Settlement) => void }) {
  const { locale, t } = useLocalization()
  const settlements = calculateSettlements(members, expenses)
  const currentUserOwes = currentUserLabel && currentUserLabel !== 'You' && currentUserLabel !== t('common.you')
    ? t('dashboard.memberOwes', { name: currentUserLabel })
    : t('dashboard.youOwe')

  return (
    <section className="content-section">
      <div className="section-heading"><h2>{t('dashboard.whoOwes')}</h2><span className="section-meta">{t('dashboard.suggestedSettlements')}</span></div>
      <div className="balance-list">
        {settlements.length ? settlements.map(settlement => (
          <div className="balance-row settlement-row" key={`${settlement.from.id}-${settlement.to.id}`}>
            <span className="settlement-avatars"><Avatar member={settlement.from} /><i>→</i><Avatar member={settlement.to} /></span>
            <span className="row-copy"><b>{settlement.from.id === 'me' ? `${currentUserOwes} ${settlement.to.name}` : t('dashboard.owesPerson', { from: settlement.from.name, to: settlement.to.name })}</b><small>{t('dashboard.suggestedPayment')}</small></span>
            <span className="settlement-action"><strong>{money(settlement.amount, currency, locale)}</strong>{onSettleUp ? <button type="button" className="settle-up-button" onClick={() => onSettleUp(settlement)}>{t('dashboard.settleUp')}</button> : null}</span>
          </div>
        )) : <div className="all-settled"><span><Check size={18} /></span><div><b>{t('dashboard.everyoneSettled')}</b><p>{t('dashboard.addExpensePrompt')}</p></div></div>}
      </div>
    </section>
  )
}

export function ExpenseList({ expenses, members, currency = 'USD', query, readOnly = false, onEditExpense, onDeleteExpense }: {
  expenses: Expense[]
  members: Member[]
  currency?: CurrencyCode
  query: string
  readOnly?: boolean
  onEditExpense?: (expense: Expense) => void
  onDeleteExpense?: (expense: Expense) => void
}) {
  const { locale, t, formatDateTime } = useLocalization()
  const memberMap = useMemo(() => new Map(members.map(member => [member.id, member])), [members])
  const normalizedQuery = query.toLowerCase()
  const visible = expenses.filter(expense => {
    if (expense.title.toLowerCase().includes(normalizedQuery)) return true
    if (!isSettlementPayment(expense)) return false
    const recipientId = getSettlementRecipientId(expense)
    return [memberMap.get(expense.payerId)?.name, recipientId ? memberMap.get(recipientId)?.name : undefined]
      .some(name => name?.toLowerCase().includes(normalizedQuery))
  })

  return (
    <section className="content-section activity-section">
      <div className="section-heading"><h2>{t('dashboard.expenses')}</h2><span className="section-meta">{visible.length} {t(visible.length === 1 ? 'dashboard.entry' : 'dashboard.entries')}</span></div>
      <div className="activity-list">
        {visible.length ? visible.map(expense => {
          const payer = memberMap.get(expense.payerId) ?? CURRENT_USER
          const settlementRecipientId = getSettlementRecipientId(expense)
          const settlementRecipient = settlementRecipientId ? memberMap.get(settlementRecipientId) : undefined
          const settlementPayment = isSettlementPayment(expense)
          const participantCount = Object.keys(expense.shares).length
          const storedTimestamp = expense.updatedAt ?? expense.createdAt
          const localizedTimestamp = formatDateTime(storedTimestamp)
          const timestampLabel = localizedTimestamp
            ? t(expense.updatedAt ? 'expense.editedAt' : 'expense.createdAt', { date: localizedTimestamp })
            : storedTimestamp === 'Just now' ? t('expense.timeUnavailable') : storedTimestamp
          const unknown = t('common.unknown')
          return (
            <div className={`activity-row${settlementPayment ? ' settlement-payment-row' : ''}`} key={expense.id}>
              <span className={`expense-icon${settlementPayment ? ' settlement-icon' : ''}`}>{settlementPayment ? <CircleDollarSign size={18} /> : <ReceiptText size={18} />}</span>
              <span className="row-copy"><b>{settlementPayment ? t('dashboard.paidPerson', { payer: payer.name, recipient: settlementRecipient?.name ?? unknown }) : expense.title}</b><small>{settlementPayment ? t('dashboard.settlementPayment') : <>{t('dashboard.paidLabel', { payer: payer.name })}<i />{t(expense.splitMethod === 'equal' ? 'dashboard.splitEqually' : 'dashboard.exactSplit')} · {participantCount} {t(participantCount === 1 ? 'common.person' : 'common.people')}</>}</small></span>
              <span className="expense-amount"><b>{money(expense.amount, currency, locale)}</b><small>{timestampLabel}</small></span>
              {readOnly ? null : (
                <span className="expense-actions">
                  {settlementPayment ? null : <button className="expense-edit" type="button" aria-label={t('dashboard.editExpense', { title: expense.title })} title={t('dashboard.editExpenseTitle')} onClick={() => onEditExpense?.(expense)}><Pencil size={15} /></button>}
                  <button className="expense-delete" type="button" aria-label={settlementPayment
                    ? t('dashboard.deletePayment', { payer: payer.name, recipient: settlementRecipient?.name ?? unknown })
                    : t('dashboard.deleteExpense', { title: expense.title })} title={t(settlementPayment ? 'dashboard.deleteSettlementTitle' : 'dashboard.deleteExpenseTitle')} onClick={() => onDeleteExpense?.(expense)}><Trash2 size={16} /></button>
                </span>
              )}
            </div>
          )
        }) : <div className="empty-state"><Sparkles size={22} /><p>{t(query ? 'dashboard.noMatches' : 'dashboard.noExpenses')}</p></div>}
      </div>
    </section>
  )
}

export function MembersRail({ members, expenses, currency = 'USD', readOnly = false, currentUserRole = 'You', onAddFriend }: { members: Member[]; expenses: Expense[]; currency?: CurrencyCode; readOnly?: boolean; currentUserRole?: string; onAddFriend?: () => void }) {
  const { locale, t } = useLocalization()
  const total = spendingExpenses(expenses).reduce((sum, expense) => sum + expense.amount, 0)
  const userRole = currentUserRole === 'You' ? t('common.you') : currentUserRole

  return (
    <aside className="right-rail activity-rail">
      <section className="members-panel">
        <div className="rail-heading"><h2>{t('dashboard.people')}</h2><span>{members.length}</span></div>
        <div className="member-list">{members.map(member => <div className="member-row" key={member.id}><Avatar member={member} size="sm" /><span><b>{member.name}</b><small>{member.id === 'me' ? userRole : t('common.friend')}</small></span>{member.id === 'me' ? <Check size={15} /> : null}</div>)}</div>
        {readOnly ? null : <button className="outline-button add-friend-button" onClick={onAddFriend}><Plus size={16} />{t('dashboard.addFriend')}</button>}
      </section>
      <section className="rail-guide">
        <span className="guide-icon"><CircleDollarSign size={22} /></span>
        <h3>{t('dashboard.howTitle')}</h3>
        <p>{t('dashboard.howText')}</p>
        <div><span>{t('dashboard.activityTotal')}</span><strong>{money(total, currency, locale)}</strong></div>
      </section>
    </aside>
  )
}

function ActivityCurrencyControl({ currency, locale, readOnly, onChange }: {
  currency: CurrencyCode
  locale: string
  readOnly: boolean
  onChange?: (currency: CurrencyCode) => void
}) {
  const { t } = useLocalization()
  const value = `${currency} · ${currencySymbol(currency, locale)}`
  const content = (
    <>
      <span className="activity-currency-icon"><CircleDollarSign size={18} /></span>
      <span className="activity-currency-copy">
        <span>{t('group.currency')}</span>
        {onChange && !readOnly ? (
          <select aria-label={t('group.currency')} value={currency} onChange={event => onChange(event.target.value as CurrencyCode)}>
            {SUPPORTED_CURRENCIES.map(code => <option key={code} value={code}>{code} · {currencySymbol(code, locale)}</option>)}
          </select>
        ) : <b>{value}</b>}
      </span>
    </>
  )

  return onChange && !readOnly
    ? <label className="activity-currency">{content}</label>
    : <div className="activity-currency activity-currency--read-only">{content}</div>
}

export function GroupDashboard({ group, members, expenses, query, activityFeedback, readOnly = false, currentUserLabel = 'You', currentUserRole, statusLabel, shareQrLabel = 'Share QR', onCurrencyChange, onShare, onShareQr, onShareLive, onAddFriend, onAddExpense, onSettleUp, onEditExpense, onDeleteExpense }: {
  group: ActivityGroup
  members: Member[]
  expenses: Expense[]
  query: string
  activityFeedback: string | null
  readOnly?: boolean
  currentUserLabel?: string
  currentUserRole?: string
  statusLabel?: string
  shareQrLabel?: string
  onCurrencyChange?: (currency: CurrencyCode) => void
  onShare?: () => void
  onShareQr?: () => void
  onShareLive?: () => void
  onAddFriend?: () => void
  onAddExpense?: () => void
  onSettleUp?: (settlement: Settlement) => void
  onEditExpense?: (expense: Expense) => void
  onDeleteExpense?: (expense: Expense) => void
}) {
  const { locale, t } = useLocalization()
  const currency = activityCurrency(group)
  return (
    <main className="dashboard">
      <div className="main-column">
        <header className="group-welcome">
          <div><span className="date">{group.emoji} {t('dashboard.activityGroup')}</span><h1>{group.name}</h1><div className="activity-meta"><p>{t('dashboard.sharing', { count: members.length, unit: t(members.length === 1 ? 'common.person' : 'common.people') })}</p><ActivityCurrencyControl currency={currency} locale={locale} readOnly={readOnly} onChange={onCurrencyChange} /></div></div>
          <div className="group-share">{readOnly ? <span className="read-only-badge">{t('dashboard.readOnly')}</span> : <div className="group-actions">{statusLabel ? <span className="read-only-badge live-badge"><Radio size={14} />{statusLabel}</span> : null}{onShareQr ? <button className="outline-button" onClick={onShareQr}><QrCode size={16} />{shareQrLabel === 'Share QR' ? t('dashboard.shareQr') : shareQrLabel}</button> : null}{onShareLive ? <button className="outline-button" onClick={onShareLive}><Radio size={16} />{t('dashboard.shareLive')}</button> : null}{onShare ? <button className="outline-button" onClick={onShare}><Share2 size={16} />{t('dashboard.shareSummary')}</button> : null}{onAddFriend ? <button className="outline-button" onClick={onAddFriend}><Users size={16} />{t('dashboard.addFriend')}</button> : null}{onAddExpense ? <button className="confirm-button" onClick={onAddExpense}><Plus size={17} />{t('dashboard.addExpense')}</button> : null}</div>}{activityFeedback ? <span className="activity-feedback" role="status">{activityFeedback}</span> : null}</div>
        </header>
        <ActivitySummary expenses={expenses} currency={currency} currentUserLabel={currentUserLabel} />
        <SettlementDirections members={members} expenses={expenses} currency={currency} currentUserLabel={currentUserLabel} onSettleUp={readOnly ? undefined : onSettleUp} />
        <ExpenseList expenses={expenses} members={members} currency={currency} query={query} readOnly={readOnly} onEditExpense={onEditExpense} onDeleteExpense={onDeleteExpense} />
      </div>
      <MembersRail members={members} expenses={expenses} currency={currency} readOnly={readOnly} currentUserRole={currentUserRole ?? (readOnly ? t('dashboard.sharedRole') : t('common.you'))} onAddFriend={onAddFriend} />
    </main>
  )
}
