import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'
import type { AnalyticsClient, AnalyticsSurface } from './analytics'
import { FreshStart, Sidebar, Topbar } from './components/AppShell'
import { createIdentity } from './data/identity'
import { EMPTY_STATE } from './data/storage'
import { activityCurrency, type CurrencyCode } from './domain/currency'
import { isSettlementPayment, money, spendingExpenses } from './domain/expenses'
import { CURRENT_USER } from './domain/members'
import type { ActivityGroup, Expense, Member, Settlement } from './domain/models'
import { GroupDashboard } from './features/activity/ActivityDashboard'
import { AddFriendModal, CreateGroupModal, ExpenseModal, SettleUpModal } from './features/activity/ActivityModals'
import {
  addLocalExpense,
  addLocalFriends,
  createActivityFriends,
  createLocalActivity,
  deleteLocalActivity,
  deleteLocalExpense,
  updateLocalActivityCurrency,
  updateLocalExpense,
} from './features/activity/activityState'
import { IdentityModal } from './features/identity/IdentityModal'
import type { LiveActivityClient } from './features/liveSharing/liveActivityConfig'
import { buildLiveActivityUrl, parseLiveActivityHash } from './features/liveSharing/liveActivityLink'
import { useLiveActivitySession } from './features/liveSharing/useLiveActivitySession'
import { exportActivitySummary } from './features/sharing/shareActivity'
import { BrowserToPwaHandoff, JoinActivityModal } from './features/sharing/JoinActivityModal'
import { copyLink, shareLink, type LinkShareResult } from './features/sharing/shareLink'
import { isStandalonePwa } from './features/sharing/sharedLinkHandoff'
import { SharedActivityIdentityModal } from './features/sharing/SharedActivityIdentityModal'
import {
  clearSharedActivityHash,
  buildSharedActivityQrUrl,
  createSharedActivity,
  decodeSharedActivityHash,
  getSharedActivitySender,
  saveSharedActivityCopy,
  type SharedActivity,
} from './features/sharing/shareActivityUrl'
import { usePersistedState } from './hooks/usePersistedState'
import { useIdentity } from './hooks/useIdentity'
import { useAppAnalytics } from './hooks/useAppAnalytics'
import { LocalizationProvider, useLocalization } from './i18n/LocalizationContext'
import { formatLocalizedList } from './i18n/localization'
import { createAppQueryClient } from './queryClient'

type ModalType = 'group' | 'friend' | 'expense' | 'settlement' | 'identity' | 'join' | 'shared-identity' | null
type ActivityFeedback = { groupId: string; message: string } | null
type QrShare = { activity: SharedActivity; url: string; mode: 'snapshot' | 'live'; activityCode?: string } | null
type AppProps = {
  analyticsClient?: AnalyticsClient | null
  liveActivityClient?: LiveActivityClient | null
}

const ShareActivityQrModal = lazy(() => import('./features/sharing/ShareActivityQrModal').then(module => ({ default: module.ShareActivityQrModal })))

function LocalizedApp({ analyticsClient = null, liveActivityClient }: AppProps = {}) {
  const [state, setState] = usePersistedState()
  const [identity, setIdentity] = useIdentity()
  const { locale, t } = useLocalization()
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ModalType>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [settlingDirection, setSettlingDirection] = useState<Settlement | null>(null)
  const [activityFeedback, setActivityFeedback] = useState<ActivityFeedback>(null)
  const [qrShare, setQrShare] = useState<QrShare>(null)
  const selectedGroupIdAtLoad = state.selectedGroupId ?? state.groups[0]?.id ?? null
  const [sharedActivity, setSharedActivity] = useState(() => parseLiveActivityHash(window.location.hash) ? null : decodeSharedActivityHash(window.location.hash))
  const live = useLiveActivitySession({
    initialSelectedGroupId: selectedGroupIdAtLoad,
    liveActivityClient,
    onSharedActivityChange: setSharedActivity,
    setPersistedState: setState,
    t,
  })

  const selectedGroup = state.groups.find(group => group.id === state.selectedGroupId) ?? state.groups[0] ?? null
  const currentUser = identity ?? { ...CURRENT_USER, name: t('common.you') }
  const selectedMembers = selectedGroup
    ? [currentUser, ...state.friends.filter(friend => selectedGroup.memberIds.includes(friend.id))]
    : [currentUser]
  const selectedExpenses = selectedGroup
    ? state.expenses.filter(expense => expense.groupId === selectedGroup.id)
    : []
  const sharedMembers = sharedActivity ? [getSharedActivitySender(sharedActivity), ...sharedActivity.friends] : []
  const liveActivity = live.activity
  const liveSession = live.session
  const liveMembers = live.members
  const activeGroup = liveActivity?.group ?? selectedGroup
  const activeMembers = liveActivity ? liveMembers : selectedMembers
  const activeExpenses = liveActivity?.expenses ?? selectedExpenses
  const displayedLiveNotice = live.displayedNotice
  const liveActivityCodes = live.activityCodes
  const bookmarkedLiveGroupId = live.bookmarkedGroupId
  const analyticsSurface: AnalyticsSurface = live.credentials
    ? 'live'
    : sharedActivity
      ? 'snapshot'
      : 'local'

  useAppAnalytics(analyticsClient, analyticsSurface, locale, liveSession?.record.code ?? null)

  const closeSharedActivity = () => {
    clearSharedActivityHash()
    setSharedActivity(null)
    setModal(null)
  }

  const closeLiveActivity = () => {
    live.close()
    setModal(null)
  }

  const closeSharedViews = () => {
    if (live.credentials) closeLiveActivity()
    else closeSharedActivity()
  }

  const joinSharedActivity = (hash: string) => {
    setModal(null)
    if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'))
    else window.location.hash = hash
  }

  const openActivity = (groupId: string) => {
    if (live.openBookmarked(groupId)) {
      setSharedActivity(null)
      setModal(null)
      return
    }
    closeSharedViews()
    setState(current => ({ ...current, selectedGroupId: groupId }))
  }

  const saveSharedActivity = (activity: NonNullable<typeof sharedActivity>, viewerId: string) => {
    setState(current => saveSharedActivityCopy(current, activity, viewerId))
    analyticsClient?.track('activity_created', 'snapshot', locale)
    closeSharedActivity()
  }

  const createGroup = (name: string, friendNames: string[], currency: CurrencyCode) => {
    setState(current => createLocalActivity(current, name, friendNames, currency))
    analyticsClient?.track('activity_created', 'local', locale)
    setModal(null)
  }

  const changeActivityCurrency = async (currency: CurrencyCode) => {
    if (!activeGroup || currency === activityCurrency(activeGroup)) return
    const message = t('feedback.currencyChanged', { currency })
    if (liveActivity) {
      await live.save(
        { ...liveActivity, group: { ...liveActivity.group, currency } },
        message,
        JSON.stringify(['change-currency', currency]),
      )
      return
    }
    setState(current => updateLocalActivityCurrency(current, activeGroup.id, currency))
    setActivityFeedback({ groupId: activeGroup.id, message })
  }

  const addFriends = async (names: string[]) => {
    if (!activeGroup) return
    const existingExpenseCount = spendingExpenses(activeExpenses).length
    const people = formatLocalizedList(names, locale)
    const addedFriendsFeedback = existingExpenseCount
      ? t(names.length === 1 ? 'friends.addedFutureOne' : 'friends.addedFutureMany', {
          people,
          count: existingExpenseCount,
          expenseUnit: t(existingExpenseCount === 1 ? 'friends.expenseOne' : 'friends.expenseMany'),
        })
      : t(names.length === 1 ? 'friends.addedOne' : 'friends.addedMany', { people })
    if (liveActivity) {
      const newFriends = createActivityFriends(names, liveActivity.friends.length)
      const saved = await live.save({
        ...liveActivity,
        friends: [...liveActivity.friends, ...newFriends],
        group: { ...liveActivity.group, memberIds: [...liveActivity.group.memberIds, ...newFriends.map(friend => friend.id)] },
      }, addedFriendsFeedback, JSON.stringify(['add-friends', names]))
      if (saved) setModal(null)
      return
    }
    setState(current => addLocalFriends(current, activeGroup.id, names))
    setActivityFeedback({ groupId: activeGroup.id, message: addedFriendsFeedback })
    setModal(null)
  }

  const addExpense = async (expense: Expense) => {
    if (liveActivity) {
      const saved = await live.save(
        { ...liveActivity, expenses: [expense, ...liveActivity.expenses] },
        t('live.addedExpense', { title: expense.title }),
        JSON.stringify(['add-expense', expense.title, expense.amount, expense.payerId, expense.splitMethod, expense.shares]),
      )
      if (saved) {
        analyticsClient?.track('expense_added', 'live', locale)
        closeExpenseModal()
      }
      return
    }
    setState(current => addLocalExpense(current, expense))
    analyticsClient?.track('expense_added', 'local', locale)
    setEditingExpense(null)
    setModal(null)
  }

  const updateExpense = async (expense: Expense) => {
    if (liveActivity) {
      const saved = await live.save({
        ...liveActivity,
        expenses: liveActivity.expenses.map(item => item.id === expense.id ? expense : item),
      }, t('live.updatedExpense', { title: expense.title }), JSON.stringify(['update-expense', expense.id, expense.title, expense.amount, expense.payerId, expense.splitMethod, expense.shares]))
      if (saved) closeExpenseModal()
      return
    }
    setState(current => updateLocalExpense(current, expense))
    setActivityFeedback({ groupId: expense.groupId, message: t('feedback.updatedExpense', { title: expense.title }) })
    setEditingExpense(null)
    setModal(null)
  }

  const openNewExpense = () => {
    setEditingExpense(null)
    setModal('expense')
  }

  const openEditExpense = (expense: Expense) => {
    setEditingExpense(expense)
    setModal('expense')
  }

  const closeExpenseModal = () => {
    setEditingExpense(null)
    setModal(null)
  }

  const openSettleUp = (settlement: Settlement) => {
    setSettlingDirection(settlement)
    setModal('settlement')
  }

  const closeSettleUpModal = () => {
    setSettlingDirection(null)
    setModal(null)
  }

  const recordSettlement = async (payment: Expense, settlement: Settlement) => {
    const message = t('feedback.settlement', { from: settlement.from.name, to: settlement.to.name, amount: money(payment.amount, activityCurrency(activeGroup!), locale) })
    if (liveActivity) {
      const saved = await live.save(
        { ...liveActivity, expenses: [payment, ...liveActivity.expenses] },
        message,
        JSON.stringify(['settlement', payment.amount, payment.payerId, payment.shares]),
      )
      if (saved) {
        analyticsClient?.track('settlement_recorded', 'live', locale)
        closeSettleUpModal()
      }
      return
    }
    setState(current => addLocalExpense(current, payment))
    analyticsClient?.track('settlement_recorded', 'local', locale)
    setActivityFeedback({ groupId: payment.groupId, message })
    closeSettleUpModal()
  }

  const shareGroup = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const result = await exportActivitySummary(group, members, expenses, locale)
    const messageKeys = {
      shared: 'feedback.summaryShared',
      copied: 'feedback.summaryCopied',
      downloaded: 'feedback.summaryDownloaded',
      cancelled: 'feedback.cancelled',
      failed: 'feedback.summaryFailed',
    } as const
    setActivityFeedback({ groupId: group.id, message: t(messageKeys[result]) })
  }

  const openShareQr = (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const activity = createSharedActivity(group, members, expenses)
    try {
      setQrShare({ activity, url: buildSharedActivityQrUrl(activity), mode: 'snapshot' })
    } catch {
      setActivityFeedback({ groupId: group.id, message: t('feedback.qrTooLarge') })
    }
  }

  const openLiveShare = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    setActivityFeedback({ groupId: group.id, message: t('live.creating') })
    const activity = createSharedActivity(group, members, expenses)
    const result = await live.create(activity, group.id)
    if (!result.ok) {
      setActivityFeedback({ groupId: group.id, message: result.message })
      return
    }
    setSharedActivity(null)
    setActivityFeedback(null)
    analyticsClient?.track('live_activity_created', 'local', locale)
    setQrShare({ activity, url: result.url, mode: 'live', activityCode: result.code })
  }

  const openCurrentLiveQr = (session: NonNullable<typeof live.session>) => {
    setQrShare({
      activity: session.record.snapshot,
      url: buildLiveActivityUrl(session.credentials),
      mode: 'live',
      activityCode: session.record.code,
    })
  }

  const reportQrShareResult = (share: NonNullable<QrShare>, result: LinkShareResult) => {
    if (share.mode === 'live') {
      const messages: Record<LinkShareResult, string> = {
        shared: t('feedback.liveShared'),
        copied: t('feedback.liveCopied'),
        cancelled: t('feedback.cancelled'),
        failed: t('feedback.liveShareFailed'),
      }
      live.notify(messages[result])
    } else {
      const messages: Record<LinkShareResult, string> = {
        shared: t('feedback.snapshotShared'),
        copied: t('feedback.snapshotCopied'),
        cancelled: t('feedback.cancelled'),
        failed: t('feedback.snapshotFailed'),
      }
      setActivityFeedback({ groupId: share.activity.group.id, message: messages[result] })
    }
    if (result === 'shared' || result === 'copied') setQrShare(null)
  }

  const shareQrLink = async (share: NonNullable<QrShare>) => {
    const result = await shareLink(t('share.linkTitle', { name: share.activity.group.name }), share.url, share.mode === 'live'
      ? t('share.liveLinkText', { name: share.activity.group.name })
      : t('share.snapshotLinkText', { name: share.activity.group.name }))
    reportQrShareResult(share, result)
  }

  const copyQrLink = async (share: NonNullable<QrShare>) => {
    const result = await copyLink(share.url)
    if (result === 'failed' && share.mode === 'live') {
      live.notify(t('feedback.liveCopyFailed'))
      return
    }
    reportQrShareResult(share, result)
  }

  const deleteExpense = async (expense: Expense) => {
    const label = isSettlementPayment(expense) ? t('confirm.deleteSettlementLabel') : t('confirm.deleteExpenseLabel', { title: expense.title })
    if (!window.confirm(t('confirm.deleteExpense', { label }))) return
    if (liveActivity) {
      await live.save(
        { ...liveActivity, expenses: liveActivity.expenses.filter(item => item.id !== expense.id) },
        t('live.deletedExpense', { title: expense.title }),
        JSON.stringify(['delete-expense', expense.id]),
      )
      return
    }
    setState(current => deleteLocalExpense(current, expense.id))
  }

  const deleteActivity = (group: ActivityGroup) => {
    if (!window.confirm(t('confirm.deleteActivity', { name: group.name }))) return
    const deletingSelectedActivity = selectedGroup?.id === group.id
    const deletingOpenLiveActivity = bookmarkedLiveGroupId === group.id
    setState(current => deleteLocalActivity(current, group.id))
    setActivityFeedback(null)
    live.removeBookmark(group.id)
    if (deletingOpenLiveActivity) closeLiveActivity()
    if (deletingSelectedActivity) setQuery('')
  }

  const resetData = () => {
    if (!window.confirm(t('confirm.reset'))) return
    setState(EMPTY_STATE)
    live.clearBookmarks()
    setQuery('')
  }

  return (
    <div className="app-shell">
      <Sidebar
        groups={state.groups}
        selectedId={sharedActivity ? null : live.credentials ? bookmarkedLiveGroupId : selectedGroup?.id ?? null}
        liveActivityCodes={liveActivityCodes}
        onSelect={openActivity}
        onCreate={() => {
          closeSharedViews()
          setModal('group')
        }}
        onJoin={() => setModal('join')}
        onDelete={deleteActivity}
        onReset={resetData}
      />
      <div className="workspace">
        <Topbar query={query} setQuery={setQuery} onSettings={() => setModal('identity')} />
        {(live.credentials || sharedActivity) && !isStandalonePwa() ? <BrowserToPwaHandoff url={window.location.href} /> : null}
        {live.credentials ? (
          <>
            <section className="shared-preview live-preview" aria-label={t('live.label')}>
              <div><strong className={displayedLiveNotice && !live.session ? 'live-error' : undefined}>{live.session ? t('live.title', { code: live.session.record.code }) : t('live.opening')}</strong><span role={displayedLiveNotice ? 'status' : undefined}>{live.saving ? t('live.saving') : displayedLiveNotice ?? (live.loading ? t('live.loadingLatest') : t('live.everyoneCanEdit'))}</span></div>
              <div>{bookmarkedLiveGroupId ? null : <button className="outline-button" onClick={closeLiveActivity}>{t('shared.back')}</button>}{live.refresh ? <button className="confirm-button" onClick={live.refresh} disabled={live.loading}>{live.loading ? t('common.loading') : t('live.refresh')}</button> : null}</div>
            </section>
            {liveActivity && liveSession ? (
              <GroupDashboard
                group={liveActivity.group}
                members={liveMembers}
                expenses={liveActivity.expenses}
                query={query}
                activityFeedback={null}
                currentUserLabel={getSharedActivitySender(liveActivity).name}
                currentUserRole={t('dashboard.creator')}
                statusLabel={t('dashboard.liveRevision', { revision: liveSession.record.revision })}
                shareQrLabel={t('dashboard.showQr')}
                onCurrencyChange={changeActivityCurrency}
                onShareQr={() => openCurrentLiveQr(liveSession)}
                onShare={() => shareGroup(liveActivity.group, liveMembers, liveActivity.expenses)}
                onAddFriend={() => setModal('friend')}
                onAddExpense={openNewExpense}
                onSettleUp={openSettleUp}
                onEditExpense={openEditExpense}
                onDeleteExpense={deleteExpense}
              />
            ) : null}
          </>
        ) : sharedActivity ? (
          <>
            <section className="shared-preview" aria-label={t('shared.previewLabel')}>
              <div><strong>{t('shared.snapshotTitle')}</strong><span>{t('shared.snapshotText')}</span></div>
              <div><button className="outline-button" onClick={closeSharedActivity}>{t('shared.back')}</button><button className="confirm-button" onClick={() => setModal('shared-identity')}>{t('shared.saveCopy')}</button></div>
            </section>
            <GroupDashboard
              group={sharedActivity.group}
              members={sharedMembers}
              expenses={sharedActivity.expenses}
              query={query}
              activityFeedback={null}
              readOnly
              currentUserLabel={getSharedActivitySender(sharedActivity).name}
            />
          </>
        ) : selectedGroup ? (
          <GroupDashboard
            group={selectedGroup}
            members={selectedMembers}
            expenses={selectedExpenses}
            query={query}
            activityFeedback={activityFeedback?.groupId === selectedGroup.id ? activityFeedback.message : null}
            currentUserLabel={currentUser.name}
            onCurrencyChange={changeActivityCurrency}
            onShare={() => shareGroup(selectedGroup, selectedMembers, selectedExpenses)}
            onShareQr={() => openShareQr(selectedGroup, selectedMembers, selectedExpenses)}
            onShareLive={() => openLiveShare(selectedGroup, selectedMembers, selectedExpenses)}
            onAddFriend={() => setModal('friend')}
            onAddExpense={openNewExpense}
            onSettleUp={openSettleUp}
            onEditExpense={openEditExpense}
            onDeleteExpense={deleteExpense}
          />
        ) : <FreshStart onCreate={() => setModal('group')} onJoin={() => setModal('join')} />}
      </div>
      {modal === 'group' ? <CreateGroupModal onClose={() => setModal(null)} onSave={createGroup} /> : null}
      {modal === 'friend' ? <AddFriendModal existingExpenseCount={spendingExpenses(activeExpenses).length} onClose={() => setModal(null)} onSave={addFriends} saving={live.saving} /> : null}
      {modal === 'expense' && activeGroup ? (
        <ExpenseModal
          group={activeGroup}
          members={activeMembers}
          expense={editingExpense ?? undefined}
          onClose={closeExpenseModal}
          onSave={editingExpense ? updateExpense : addExpense}
          saving={live.saving}
        />
      ) : null}
      {modal === 'settlement' && activeGroup && settlingDirection ? <SettleUpModal group={activeGroup} settlement={settlingDirection} onClose={closeSettleUpModal} onSave={recordSettlement} saving={live.saving} /> : null}
      {modal === 'shared-identity' && sharedActivity ? <SharedActivityIdentityModal members={sharedMembers} onClose={() => setModal(null)} onSave={viewerId => saveSharedActivity(sharedActivity, viewerId)} /> : null}
      {modal === 'join' ? <JoinActivityModal onClose={() => setModal(null)} onJoin={joinSharedActivity} /> : null}
      {qrShare ? <Suspense fallback={null}><ShareActivityQrModal groupName={qrShare.activity.group.name} url={qrShare.url} mode={qrShare.mode} activityCode={qrShare.activityCode} onClose={() => setQrShare(null)} onCopy={() => copyQrLink(qrShare)} onShare={() => shareQrLink(qrShare)} /></Suspense> : null}
      {!identity || modal === 'identity' ? <IdentityModal initialName={identity?.name} onClose={identity ? () => setModal(null) : undefined} onSave={name => { setIdentity(createIdentity(name)); setModal(null) }} /> : null}
    </div>
  )
}

export default function App(props: AppProps = {}) {
  const [queryClient] = useState(createAppQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <LocalizationProvider><LocalizedApp {...props} /></LocalizationProvider>
    </QueryClientProvider>
  )
}
