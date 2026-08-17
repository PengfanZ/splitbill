import { QueryClientProvider } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { AnalyticsClient, AnalyticsEvent, AnalyticsSurface } from './analytics'
import { FreshStart, Sidebar, Topbar } from './components/AppShell'
import { ConfirmDialog } from './components/ConfirmDialog'
import { removeActivityIdentity, selectActivityIdentity } from './data/activityIdentity'
import { createIdentity } from './data/identity'
import { EMPTY_STATE } from './data/storage'
import { activityCurrency, currencyLabel, type CurrencyCode } from './domain/currency'
import { isSettlementPayment, money, spendingExpenses } from './domain/expenses'
import { CURRENT_USER } from './domain/members'
import type { ActivityGroup, Expense, Settlement } from './domain/models'
import type { AiExpenseClient } from './features/aiExpense/aiExpenseApi'
import { withAiExpenseAnalytics } from './features/aiExpense/aiExpenseAnalytics'
import { GroupDashboard } from './features/activity/ActivityDashboard'
import { AddFriendModal, CreateGroupModal, ExpenseModal, SettleUpModal, type ExpenseInputTab } from './features/activity/ActivityModals'
import {
  hasSeenLatestChangelog,
  LATEST_CHANGELOG_ID,
  markLatestChangelogSeen,
} from './features/changelog/changelog'
import type { FeedbackClient, FeedbackRating } from './features/feedback/feedbackApi'
import {
  markRatingPromptHandled,
  shouldShowRatingPrompt,
} from './features/feedback/ratingPromptStorage'
import {
  addLocalExpense,
  addLocalExpenses,
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
import { LiveActivityStatusBanner } from './features/liveSharing/LiveActivityStatusBanner'
import { useLiveActivitySession } from './features/liveSharing/useLiveActivitySession'
import { BrowserToPwaHandoff, JoinActivityModal } from './features/sharing/JoinActivityModal'
import { isStandalonePwa } from './features/sharing/sharedLinkHandoff'
import { LiveActivityIdentityModal, type LiveActivityIdentityMode } from './features/sharing/LiveActivityIdentityModal'
import {
  getSharedActivitySender,
  saveSharedActivityCopy,
} from './features/sharing/sharedActivity'
import { useActivitySharing, type ActivityFeedback } from './features/sharing/useActivitySharing'
import { usePersistedState } from './hooks/usePersistedState'
import { useIdentity } from './hooks/useIdentity'
import { useAppAnalytics } from './hooks/useAppAnalytics'
import { useActivityIdentitySelections } from './hooks/useActivityIdentitySelections'
import { LocalizationProvider, useLocalization } from './i18n/LocalizationContext'
import { formatLocalizedList } from './i18n/localization'
import { createAppQueryClient } from './queryClient'

type ModalType = 'group' | 'friend' | 'expense' | 'settlement' | 'identity' | 'join' | 'live-identity' | 'feedback' | null
type AppProps = {
  aiExpenseClient?: Pick<AiExpenseClient, 'parseBatch'> | null
  analyticsClient?: AnalyticsClient | null
  feedbackClient?: Pick<FeedbackClient, 'submit'> | null
  liveActivityClient?: LiveActivityClient | null
}
type ConfirmationRequest = {
  confirmLabel: string
  description: string
  onConfirm: () => boolean | void | Promise<boolean | void>
  title: string
}

const LiveActivityQrModal = lazy(() => import('./features/sharing/LiveActivityQrModal').then(module => ({ default: module.LiveActivityQrModal })))
const ChangelogModal = lazy(() => import('./features/changelog/ChangelogModal').then(module => ({ default: module.ChangelogModal })))
const FeedbackModal = lazy(() => import('./features/feedback/FeedbackModal').then(module => ({ default: module.FeedbackModal })))
const RatingPrompt = lazy(() => import('./features/feedback/RatingPrompt').then(module => ({ default: module.RatingPrompt })))

const EXPENSE_INPUT_TAB_EVENTS: Record<ExpenseInputTab, AnalyticsEvent> = {
  manual: 'expense_input_manual_selected',
  'ai-text': 'expense_input_ai_text_selected',
  'ai-voice': 'expense_input_ai_voice_selected',
}

function LocalizedApp({ aiExpenseClient = null, analyticsClient = null, feedbackClient = null, liveActivityClient }: AppProps = {}) {
  const [state, setState] = usePersistedState()
  const [identity, setIdentity] = useIdentity()
  const [activityIdentities, setActivityIdentities] = useActivityIdentitySelections()
  const [changelogState, setChangelogState] = useState(() => {
    const seen = hasSeenLatestChangelog()
    return { open: Boolean(identity) && !seen, unread: !seen }
  })
  const { locale, t } = useLocalization()
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ModalType>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [settlingDirection, setSettlingDirection] = useState<Settlement | null>(null)
  const [activityFeedback, setActivityFeedback] = useState<ActivityFeedback>(null)
  const [liveIdentityMode, setLiveIdentityMode] = useState<LiveActivityIdentityMode | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [confirmationBusy, setConfirmationBusy] = useState(false)
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null)
  const [feedbackInitialRating, setFeedbackInitialRating] = useState<FeedbackRating | null>(null)
  const [ratingPromptOpen, setRatingPromptOpen] = useState(false)
  const selectedGroupIdAtLoad = state.selectedGroupId ?? state.groups[0]?.id ?? null
  const live = useLiveActivitySession({
    initialSelectedGroupId: selectedGroupIdAtLoad,
    liveActivityClient,
    setPersistedState: setState,
    t,
  })

  const selectedGroup = useMemo(
    () => state.groups.find(group => group.id === state.selectedGroupId) ?? state.groups[0] ?? null,
    [state.groups, state.selectedGroupId],
  )
  const currentUser = useMemo(
    () => identity ?? { ...CURRENT_USER, name: t('common.you') },
    [identity, t],
  )
  const selectedMembers = useMemo(
    () => selectedGroup
      ? [currentUser, ...state.friends.filter(friend => selectedGroup.memberIds.includes(friend.id))]
      : [currentUser],
    [currentUser, selectedGroup, state.friends],
  )
  const selectedExpenses = useMemo(
    () => selectedGroup
      ? state.expenses.filter(expense => expense.groupId === selectedGroup.id)
      : [],
    [selectedGroup, state.expenses],
  )
  const liveActivity = live.activity
  const liveSession = live.session
  const liveMembers = live.members
  const activeGroup = liveActivity?.group ?? selectedGroup
  const activeMembers = liveActivity ? liveMembers : selectedMembers
  const activeExpenses = liveActivity?.expenses ?? selectedExpenses
  const activeIdentityScope = activeGroup
    ? live.credentials ? `live:${live.credentials.code}` : `local:${activeGroup.id}`
    : null
  const activeMemberId = useMemo(() => {
    if (!activeIdentityScope) return null
    const savedMemberId = activityIdentities[activeIdentityScope]
    if (savedMemberId && activeMembers.some(member => member.id === savedMemberId)) return savedMemberId
    if (!liveActivity) return 'me'
    const identityName = identity?.name.trim().toLocaleLowerCase()
    if (!identityName) return null
    const matchingMembers = activeMembers.filter(member => member.name.trim().toLocaleLowerCase() === identityName)
    return matchingMembers.length === 1 ? matchingMembers[0].id : null
  }, [activeIdentityScope, activeMembers, activityIdentities, identity?.name, liveActivity])
  const activeMember = activeMembers.find(member => member.id === activeMemberId) ?? null
  const liveEditBlocked = Boolean(live.credentials && !live.editable)
  const displayedGroup = liveActivity?.group ?? selectedGroup
  const displayedMemberCount = liveActivity
    ? liveMembers.length
    : selectedGroup
      ? selectedMembers.length
      : 0
  const displayedLiveNotice = live.displayedNotice
  const liveEnd = live.end
  const liveActivityCodes = live.activityCodes
  const bookmarkedLiveGroupId = live.bookmarkedGroupId
  const analyticsSurface: AnalyticsSurface = live.credentials ? 'live' : 'local'
  const trackedAiExpenseClient = useMemo(
    () => withAiExpenseAnalytics(aiExpenseClient, analyticsClient, analyticsSurface, locale),
    [aiExpenseClient, analyticsClient, analyticsSurface, locale],
  )
  const handleSuccessfulShare = () => {
    if (feedbackClient && shouldShowRatingPrompt(LATEST_CHANGELOG_ID)) setRatingPromptOpen(true)
  }
  const sharing = useActivitySharing({
    analyticsClient,
    createLiveActivity: live.create,
    locale,
    notifyLive: live.notify,
    onShareCompleted: handleSuccessfulShare,
    setActivityFeedback,
    t,
  })
  const qrShare = sharing.qrShare

  const changeActiveMember = activeIdentityScope
    ? (memberId: string) => setActivityIdentities(current => selectActivityIdentity(current, activeIdentityScope, memberId))
    : undefined

  useAppAnalytics(analyticsClient, analyticsSurface, locale, liveSession?.record.code ?? null)

  useEffect(() => {
    if (!feedbackNotice) return
    const timer = window.setTimeout(() => setFeedbackNotice(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [feedbackNotice])

  const openChangelog = () => {
    markLatestChangelogSeen()
    setChangelogState({ open: true, unread: false })
  }

  const closeChangelog = () => {
    markLatestChangelogSeen()
    setChangelogState({ open: false, unread: false })
  }

  const openFeedback = () => {
    setFeedbackInitialRating(null)
    setModal('feedback')
  }

  const openFeedbackFromRatingPrompt = (rating: FeedbackRating | null) => {
    markRatingPromptHandled(LATEST_CHANGELOG_ID)
    setRatingPromptOpen(false)
    setFeedbackInitialRating(rating)
    setModal('feedback')
  }

  const closeFeedback = () => {
    setFeedbackInitialRating(null)
    setModal(null)
  }

  const closeRatingPrompt = () => {
    markRatingPromptHandled(LATEST_CHANGELOG_ID)
    setRatingPromptOpen(false)
  }

  const finishFeedback = () => {
    analyticsClient?.track('feedback_submitted', analyticsSurface, locale)
    markRatingPromptHandled(LATEST_CHANGELOG_ID)
    setRatingPromptOpen(false)
    setFeedbackInitialRating(null)
    setModal(null)
    setFeedbackNotice(t('feedbackForm.success'))
  }

  const closeLiveActivity = () => {
    live.close()
    setModal(null)
    setLiveIdentityMode(null)
  }

  const joinSharedActivity = (hash: string) => {
    setModal(null)
    if (window.location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'))
    else window.location.hash = hash
  }

  const openActivity = (groupId: string) => {
    if (live.openBookmarked(groupId)) {
      setModal(null)
      return
    }
    if (live.credentials) closeLiveActivity()
    setState(current => ({ ...current, selectedGroupId: groupId }))
  }

  const saveLiveActivityCopy = (
    activityToCopy: NonNullable<typeof liveActivity>,
    identityMode: NonNullable<typeof liveIdentityMode>,
    viewerId: string,
  ) => {
    const sourceGroupId = live.mirroredGroupId
    const replacingExpiredLiveActivity = identityMode === 'live-recovery' && sourceGroupId
    const activity = identityMode === 'live-copy'
      ? { ...activityToCopy, group: { ...activityToCopy.group, name: t('live.copyName', { name: activityToCopy.group.name }) } }
      : activityToCopy
    setState(current => {
      const baseState = replacingExpiredLiveActivity
        ? deleteLocalActivity(current, sourceGroupId)
        : current
      return saveSharedActivityCopy(baseState, activity, viewerId)
    })
    if (replacingExpiredLiveActivity) live.removeBookmark(sourceGroupId)
    analyticsClient?.track('activity_created', 'local', locale)
    closeLiveActivity()
  }

  const createGroup = (name: string, friendNames: string[], currency: CurrencyCode) => {
    setState(current => createLocalActivity(current, name, friendNames, currency))
    analyticsClient?.track('activity_created', 'local', locale)
    if (friendNames.length > 0) analyticsClient?.track('friend_added', 'local', locale)
    setModal(null)
  }

  const changeActivityCurrency = async (currency: CurrencyCode) => {
    if (!activeGroup || currency === activityCurrency(activeGroup)) return
    analyticsClient?.track('currency_selected', liveActivity ? 'live' : 'local', locale, currency)
    const message = t('feedback.currencyChanged', { currency: currencyLabel(currency, locale) })
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
      if (saved) {
        analyticsClient?.track('friend_added', 'live', locale)
        setModal(null)
      }
      return
    }
    setState(current => addLocalFriends(current, activeGroup.id, names))
    analyticsClient?.track('friend_added', 'local', locale)
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

  const addExpenses = async (expenses: Expense[]) => {
    /* v8 ignore next -- The validated batch result and disabled empty review action enforce this invariant. */
    if (expenses.length === 0) return
    if (liveActivity) {
      const saved = await live.save(
        { ...liveActivity, expenses: [...expenses, ...liveActivity.expenses] },
        t('live.addedExpenses', { count: expenses.length }),
        JSON.stringify(['add-expenses', expenses.map(item => [item.title, item.amount, item.payerId, item.splitMethod, item.shares])]),
      )
      if (saved) {
        analyticsClient?.track('expense_added', 'live', locale)
        closeExpenseModal()
      }
      return
    }
    setState(current => addLocalExpenses(current, expenses))
    analyticsClient?.track('expense_added', 'local', locale)
    setActivityFeedback({ groupId: expenses[0].groupId, message: t('feedback.addedExpenses', { count: expenses.length }) })
    closeExpenseModal()
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

  const confirmRequest = async (request: ConfirmationRequest) => {
    setConfirmationBusy(true)
    try {
      const confirmed = await request.onConfirm()
      if (confirmed !== false) setConfirmation(null)
    } finally {
      setConfirmationBusy(false)
    }
  }

  const endLiveActivity = (end: NonNullable<typeof live.end>) => {
    setConfirmation({
      title: t('confirm.endLiveTitle'),
      description: t('confirm.endLive'),
      confirmLabel: t('confirm.endLiveAction'),
      onConfirm: end,
    })
  }

  const deleteExpense = (expense: Expense) => {
    const label = isSettlementPayment(expense) ? t('confirm.deleteSettlementLabel') : t('confirm.deleteExpenseLabel', { title: expense.title })
    setConfirmation({
      title: t('confirm.deleteExpenseTitle'),
      description: t('confirm.deleteExpense', { label }),
      confirmLabel: t('confirm.deleteAction'),
      onConfirm: async () => {
        if (liveActivity) {
          await live.save(
            { ...liveActivity, expenses: liveActivity.expenses.filter(item => item.id !== expense.id) },
            t('live.deletedExpense', { title: expense.title }),
            JSON.stringify(['delete-expense', expense.id]),
          )
          return
        }
        setState(current => deleteLocalExpense(current, expense.id))
      },
    })
  }

  const deleteActivity = (group: ActivityGroup) => {
    setConfirmation({
      title: t('confirm.deleteActivityTitle'),
      description: t('confirm.deleteActivity', { name: group.name }),
      confirmLabel: t('confirm.deleteAction'),
      onConfirm: () => {
        const deletingSelectedActivity = selectedGroup?.id === group.id
        const deletingOpenLiveActivity = bookmarkedLiveGroupId === group.id
        setState(current => deleteLocalActivity(current, group.id))
        setActivityIdentities(current => removeActivityIdentity(current, `local:${group.id}`))
        setActivityFeedback(null)
        live.removeBookmark(group.id)
        if (deletingOpenLiveActivity) closeLiveActivity()
        if (deletingSelectedActivity) setQuery('')
      },
    })
  }

  const resetData = () => {
    setConfirmation({
      title: t('confirm.resetTitle'),
      description: t('confirm.reset'),
      confirmLabel: t('confirm.resetAction'),
      onConfirm: () => {
        setState(EMPTY_STATE)
        setActivityIdentities({})
        live.clearBookmarks()
        setQuery('')
      },
    })
  }

  return (
    <div className="app-shell">
      <Sidebar
        groups={state.groups}
        selectedId={live.credentials ? bookmarkedLiveGroupId : selectedGroup?.id ?? null}
        liveActivityCodes={liveActivityCodes}
        onSelect={openActivity}
        onCreate={() => {
          if (live.credentials) closeLiveActivity()
          setModal('group')
        }}
        onJoin={() => setModal('join')}
        onShowChangelog={openChangelog}
        onSendFeedback={() => openFeedback()}
        hasUnreadChangelog={changelogState.unread}
        onDelete={deleteActivity}
        onReset={resetData}
      />
      <div className="workspace">
        <Topbar
          query={query}
          setQuery={setQuery}
          onSettings={() => setModal('identity')}
          activityName={displayedGroup?.name}
          activityEmoji={displayedGroup?.emoji}
          activityDetail={displayedGroup ? t('nav.memberCount', {
            count: displayedMemberCount,
            unit: t(displayedMemberCount === 1 ? 'common.person' : 'common.people'),
          }) : undefined}
        />
        {live.credentials && !isStandalonePwa() ? <BrowserToPwaHandoff url={window.location.href} /> : null}
        {live.credentials ? (
          <>
            <LiveActivityStatusBanner
              state={live.connectionState!}
              code={liveSession?.record.code ?? live.mirror?.code}
              notice={live.saving ? t('live.saving') : displayedLiveNotice}
              browserOnline={live.browserOnline}
              refreshing={live.loading}
              hasBookmark={Boolean(bookmarkedLiveGroupId)}
              onBack={closeLiveActivity}
              onRefresh={live.refresh}
              onDuplicate={live.connectionState === 'cached' && liveActivity
                ? () => {
                    setLiveIdentityMode('live-copy')
                    setModal('live-identity')
                  }
                : undefined}
              onContinueLocally={live.connectionState === 'expired' && liveActivity
                ? () => {
                    setLiveIdentityMode('live-recovery')
                    setModal('live-identity')
                  }
                : undefined}
            />
            {liveActivity ? (
              <GroupDashboard
                group={liveActivity.group}
                members={liveMembers}
                expenses={liveActivity.expenses}
                query={query}
                activityFeedback={activityFeedback?.groupId === liveActivity.group.id ? activityFeedback.message : null}
                readOnly={!live.editable}
                readOnlyLabel={t('dashboard.editingPaused')}
                currentMemberId={activeMemberId}
                currentUserLabel={activeMember?.name ?? getSharedActivitySender(liveActivity).name}
                onCurrentMemberChange={changeActiveMember}
                statusLabel={live.connectionState === 'connected' && liveSession
                  ? t('dashboard.liveRevision', { revision: liveSession.record.revision })
                  : t('dashboard.savedRevision', { revision: live.mirror!.revision })}
                onCurrencyChange={live.editable ? changeActivityCurrency : undefined}
                onShareQr={live.editable && liveSession ? () => sharing.openCurrentLiveQr(liveSession) : undefined}
                onCopyShareLink={live.editable && liveSession ? () => sharing.copyCurrentLiveLink(liveSession) : undefined}
                onEndLive={live.editable && liveEnd ? () => endLiveActivity(liveEnd) : undefined}
                onShareSummary={() => sharing.shareGroup(liveActivity.group, liveMembers, liveActivity.expenses, 'live', liveSession)}
                onAddFriend={live.editable ? () => setModal('friend') : undefined}
                onAddExpense={live.editable ? openNewExpense : undefined}
                onSettleUp={live.editable ? openSettleUp : undefined}
                onEditExpense={live.editable ? openEditExpense : undefined}
                onDeleteExpense={live.editable ? deleteExpense : undefined}
              />
            ) : null}
          </>
        ) : selectedGroup ? (
          <GroupDashboard
            group={selectedGroup}
            members={selectedMembers}
            expenses={selectedExpenses}
            query={query}
            activityFeedback={activityFeedback?.groupId === selectedGroup.id ? activityFeedback.message : null}
            currentMemberId={activeMemberId}
            currentUserLabel={activeMember!.name}
            onCurrentMemberChange={changeActiveMember}
            onCurrencyChange={changeActivityCurrency}
            onShareSummary={() => sharing.shareGroup(selectedGroup, selectedMembers, selectedExpenses, 'local')}
            onShareLive={() => sharing.openLiveShare(selectedGroup, selectedMembers, selectedExpenses)}
            onAddFriend={() => setModal('friend')}
            onAddExpense={openNewExpense}
            onSettleUp={openSettleUp}
            onEditExpense={openEditExpense}
            onDeleteExpense={deleteExpense}
          />
        ) : <FreshStart onCreate={() => setModal('group')} onJoin={() => setModal('join')} />}
      </div>
      {modal === 'group' ? <CreateGroupModal
        onClose={() => setModal(null)}
        onCurrencySelect={currency => analyticsClient?.track('currency_selected', 'local', locale, currency)}
        onSave={createGroup}
      /> : null}
      {modal === 'friend' ? <AddFriendModal existingExpenseCount={spendingExpenses(activeExpenses).length} onClose={() => setModal(null)} onSave={addFriends} saving={live.saving || liveEditBlocked} /> : null}
      {modal === 'expense' && activeGroup ? (
        <ExpenseModal
          group={activeGroup}
          members={activeMembers}
          expense={editingExpense ?? undefined}
          aiExpenseClient={trackedAiExpenseClient}
          currentMemberId={activeMemberId}
          onCurrentMemberChange={changeActiveMember}
          onEntryTabSelect={tab => analyticsClient?.track(EXPENSE_INPUT_TAB_EVENTS[tab], analyticsSurface, locale)}
          onClose={closeExpenseModal}
          onSave={editingExpense ? updateExpense : addExpense}
          onSaveMany={addExpenses}
          saving={live.saving || liveEditBlocked}
        />
      ) : null}
      {modal === 'settlement' && activeGroup && settlingDirection ? <SettleUpModal group={activeGroup} settlement={settlingDirection} onClose={closeSettleUpModal} onSave={recordSettlement} saving={live.saving || liveEditBlocked} /> : null}
      {modal === 'live-identity' && liveActivity && liveIdentityMode ? <LiveActivityIdentityModal members={liveMembers} mode={liveIdentityMode} onClose={() => { setModal(null); setLiveIdentityMode(null) }} onSave={viewerId => saveLiveActivityCopy(liveActivity, liveIdentityMode, viewerId)} /> : null}
      {modal === 'join' ? <JoinActivityModal onClose={() => setModal(null)} onJoin={joinSharedActivity} /> : null}
      {qrShare ? <Suspense fallback={null}><LiveActivityQrModal groupName={qrShare.groupName} url={qrShare.url} activityCode={qrShare.activityCode} onClose={sharing.closeQrShare} onCopy={() => sharing.copyQrLink(qrShare)} onShare={() => sharing.shareQrLink(qrShare)} /></Suspense> : null}
      {changelogState.open ? <Suspense fallback={null}><ChangelogModal onClose={closeChangelog} /></Suspense> : null}
      {modal === 'feedback' ? <Suspense fallback={null}><FeedbackModal
        client={feedbackClient}
        initialRating={feedbackInitialRating}
        release={LATEST_CHANGELOG_ID}
        surface={analyticsSurface}
        onClose={closeFeedback}
        onSubmitted={finishFeedback}
      /></Suspense> : null}
      {confirmation ? (
        <ConfirmDialog
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          busy={confirmationBusy}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => confirmRequest(confirmation)}
        />
      ) : null}
      {!identity || modal === 'identity' ? <IdentityModal initialName={identity?.name} onClose={identity ? () => setModal(null) : undefined} onSave={name => {
        if (!identity) {
          markLatestChangelogSeen()
          setChangelogState({ open: false, unread: false })
        }
        setIdentity(createIdentity(name))
        setModal(null)
      }} /> : null}
      {ratingPromptOpen && feedbackClient ? <Suspense fallback={null}><RatingPrompt
        client={feedbackClient}
        release={LATEST_CHANGELOG_ID}
        surface={analyticsSurface}
        onDismiss={closeRatingPrompt}
        onAddNote={openFeedbackFromRatingPrompt}
        onSubmitted={finishFeedback}
      /></Suspense> : null}
      {feedbackNotice ? <div className="app-toast" role="status"><CheckCircle2 size={18} /><span>{feedbackNotice}</span></div> : null}
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
