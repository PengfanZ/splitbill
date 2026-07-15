import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { AnalyticsClient, AnalyticsSurface } from './analytics'
import { FreshStart, Sidebar, Topbar } from './components/AppShell'
import { createIdentity } from './data/identity'
import { EMPTY_STATE } from './data/storage'
import { isSettlementPayment, money, spendingExpenses } from './domain/expenses'
import { ACTIVITY_EMOJIS, addedFriendsMessage, CURRENT_USER, FRIEND_COLORS, initialsFor, makeId } from './domain/members'
import type { ActivityGroup, Expense, Member, Settlement } from './domain/models'
import { GroupDashboard } from './features/activity/ActivityDashboard'
import { AddFriendModal, CreateGroupModal, ExpenseModal, SettleUpModal } from './features/activity/ActivityModals'
import { IdentityModal } from './features/identity/IdentityModal'
import type { LiveActivityClient } from './features/liveSharing/liveActivityConfig'
import { buildLiveActivityUrl, parseLiveActivityHash } from './features/liveSharing/liveActivityLink'
import { useLiveActivitySession } from './features/liveSharing/useLiveActivitySession'
import { exportActivitySummary, SHARE_MESSAGES } from './features/sharing/shareActivity'
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
  SHARE_URL_MESSAGES,
  type SharedActivity,
} from './features/sharing/shareActivityUrl'
import { usePersistedState } from './hooks/usePersistedState'
import { useIdentity } from './hooks/useIdentity'

type ModalType = 'group' | 'friend' | 'expense' | 'settlement' | 'identity' | 'join' | 'shared-identity' | null
type ActivityFeedback = { groupId: string; message: string } | null
type QrShare = { activity: SharedActivity; url: string; mode: 'snapshot' | 'live'; activityCode?: string } | null
type AppProps = {
  analyticsClient?: AnalyticsClient | null
  liveActivityClient?: LiveActivityClient | null
}

const ShareActivityQrModal = lazy(() => import('./features/sharing/ShareActivityQrModal').then(module => ({ default: module.ShareActivityQrModal })))

function createFriends(names: string[], colorOffset: number): Member[] {
  return names.map((name, index) => ({
    id: makeId('friend'),
    name,
    initials: initialsFor(name),
    color: FRIEND_COLORS[(colorOffset + index) % FRIEND_COLORS.length],
  }))
}

export default function App({ analyticsClient = null, liveActivityClient }: AppProps = {}) {
  const [state, setState] = usePersistedState()
  const [identity, setIdentity] = useIdentity()
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
  })

  const selectedGroup = state.groups.find(group => group.id === state.selectedGroupId) ?? state.groups[0] ?? null
  const currentUser = identity ?? CURRENT_USER
  const selectedMembers = selectedGroup
    ? [currentUser, ...state.friends.filter(friend => selectedGroup.memberIds.includes(friend.id))]
    : [currentUser]
  const selectedExpenses = selectedGroup
    ? state.expenses.filter(expense => expense.groupId === selectedGroup.id)
    : []
  const sharedMembers = sharedActivity ? [getSharedActivitySender(sharedActivity), ...sharedActivity.friends] : []
  const liveActivity = live.activity
  const liveMembers = live.members
  const activeGroup = liveActivity?.group ?? selectedGroup
  const activeMembers = liveActivity ? liveMembers : selectedMembers
  const activeExpenses = liveActivity?.expenses ?? selectedExpenses
  const displayedLiveNotice = live.displayedNotice
  const liveActivityCodes = live.activityCodes
  const bookmarkedLiveGroupId = live.bookmarkedGroupId
  const initialOpenTracked = useRef(false)
  const trackedLiveActivityCode = useRef<string | null>(null)
  const analyticsSurface: AnalyticsSurface = live.credentials
    ? 'live'
    : sharedActivity
      ? 'snapshot'
      : 'local'

  useEffect(() => {
    if (initialOpenTracked.current) return
    initialOpenTracked.current = true
    analyticsClient?.track('app_opened', analyticsSurface)
  }, [analyticsClient, analyticsSurface])

  useEffect(() => {
    const code = live.session?.record.code ?? null
    if (!code) {
      trackedLiveActivityCode.current = null
      return
    }
    if (trackedLiveActivityCode.current === code) return
    trackedLiveActivityCode.current = code
    analyticsClient?.track('live_activity_opened', 'live')
  }, [analyticsClient, live.session?.record.code])

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
    analyticsClient?.track('activity_created', 'snapshot')
    closeSharedActivity()
  }

  const createGroup = (name: string, friendNames: string[]) => {
    const groupId = makeId('group')
    setState(current => {
      const newFriends = createFriends(friendNames, current.friends.length)
      const group: ActivityGroup = {
        id: groupId,
        name,
        emoji: ACTIVITY_EMOJIS[current.groups.length % ACTIVITY_EMOJIS.length],
        memberIds: ['me', ...newFriends.map(friend => friend.id)],
      }
      return {
        ...current,
        groups: [...current.groups, group],
        friends: [...current.friends, ...newFriends],
        selectedGroupId: group.id,
      }
    })
    analyticsClient?.track('activity_created', 'local')
    setModal(null)
  }

  const addFriends = async (names: string[]) => {
    if (!activeGroup) return
    const existingExpenseCount = spendingExpenses(activeExpenses).length
    if (liveActivity) {
      const newFriends = createFriends(names, liveActivity.friends.length)
      const saved = await live.save({
        ...liveActivity,
        friends: [...liveActivity.friends, ...newFriends],
        group: { ...liveActivity.group, memberIds: [...liveActivity.group.memberIds, ...newFriends.map(friend => friend.id)] },
      }, addedFriendsMessage(names, existingExpenseCount))
      if (saved) setModal(null)
      return
    }
    setState(current => {
      const newFriends = createFriends(names, current.friends.length)
      return {
        ...current,
        friends: [...current.friends, ...newFriends],
        groups: current.groups.map(group => group.id === activeGroup.id
          ? { ...group, memberIds: [...group.memberIds, ...newFriends.map(friend => friend.id)] }
          : group),
      }
    })
    setActivityFeedback({ groupId: activeGroup.id, message: addedFriendsMessage(names, existingExpenseCount) })
    setModal(null)
  }

  const addExpense = async (expense: Expense) => {
    if (liveActivity) {
      const saved = await live.save({ ...liveActivity, expenses: [expense, ...liveActivity.expenses] }, `${expense.title} was added to the live activity.`)
      if (saved) {
        analyticsClient?.track('expense_added', 'live')
        closeExpenseModal()
      }
      return
    }
    setState(current => ({ ...current, expenses: [expense, ...current.expenses] }))
    analyticsClient?.track('expense_added', 'local')
    setEditingExpense(null)
    setModal(null)
  }

  const updateExpense = async (expense: Expense) => {
    if (liveActivity) {
      const saved = await live.save({
        ...liveActivity,
        expenses: liveActivity.expenses.map(item => item.id === expense.id ? expense : item),
      }, `${expense.title} was updated. Splits and balances were recalculated.`)
      if (saved) closeExpenseModal()
      return
    }
    setState(current => ({
      ...current,
      expenses: current.expenses.map(item => item.id === expense.id ? expense : item),
    }))
    setActivityFeedback({ groupId: expense.groupId, message: `${expense.title} was updated. Splits and balances were recalculated.` })
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
    const message = `${settlement.from.name} paid ${settlement.to.name} ${money(payment.amount)}. Remaining balances were recalculated.`
    if (liveActivity) {
      const saved = await live.save({ ...liveActivity, expenses: [payment, ...liveActivity.expenses] }, message)
      if (saved) {
        analyticsClient?.track('settlement_recorded', 'live')
        closeSettleUpModal()
      }
      return
    }
    setState(current => ({ ...current, expenses: [payment, ...current.expenses] }))
    analyticsClient?.track('settlement_recorded', 'local')
    setActivityFeedback({ groupId: payment.groupId, message })
    closeSettleUpModal()
  }

  const shareGroup = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const result = await exportActivitySummary(group, members, expenses)
    setActivityFeedback({ groupId: group.id, message: SHARE_MESSAGES[result] })
  }

  const openShareQr = (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const activity = createSharedActivity(group, members, expenses)
    try {
      setQrShare({ activity, url: buildSharedActivityQrUrl(activity), mode: 'snapshot' })
    } catch {
      setActivityFeedback({ groupId: group.id, message: 'This activity is too large for a reliable QR code. Use Share summary instead.' })
    }
  }

  const openLiveShare = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    setActivityFeedback({ groupId: group.id, message: 'Creating a private live activity link…' })
    const activity = createSharedActivity(group, members, expenses)
    const result = await live.create(activity, group.id)
    if (!result.ok) {
      setActivityFeedback({ groupId: group.id, message: result.message })
      return
    }
    setSharedActivity(null)
    setActivityFeedback(null)
    analyticsClient?.track('live_activity_created', 'local')
    setQrShare({ activity, url: result.url, mode: 'live', activityCode: result.code })
  }

  const openCurrentLiveQr = () => {
    const session = live.session!
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
        shared: 'Live activity link shared. Anyone with it can edit this activity.',
        copied: 'Live activity link copied. Anyone with it can edit this activity.',
        cancelled: 'Sharing cancelled.',
        failed: 'Could not share the live activity link. Please try again.',
      }
      live.notify(messages[result])
    } else {
      setActivityFeedback({ groupId: share.activity.group.id, message: SHARE_URL_MESSAGES[result] })
    }
    if (result === 'shared' || result === 'copied') setQrShare(null)
  }

  const shareQrLink = async (share: NonNullable<QrShare>) => {
    const result = await shareLink(`${share.activity.group.name} — Tally`, share.url, share.mode === 'live'
      ? `Join ${share.activity.group.name} and edit expenses together in Tally.`
      : `View ${share.activity.group.name} in Tally.`)
    reportQrShareResult(share, result)
  }

  const copyQrLink = async (share: NonNullable<QrShare>) => {
    const result = await copyLink(share.url)
    if (result === 'failed' && share.mode === 'live') {
      live.notify('Could not copy the live activity link. Please try Share link instead.')
      return
    }
    reportQrShareResult(share, result)
  }

  const deleteExpense = async (expense: Expense) => {
    const label = isSettlementPayment(expense) ? 'this settlement payment' : `"${expense.title}"`
    if (!window.confirm(`Delete ${label}? This removes it from the activity and recalculates everyone’s balances.`)) return
    if (liveActivity) {
      await live.save({ ...liveActivity, expenses: liveActivity.expenses.filter(item => item.id !== expense.id) }, `${expense.title} was deleted from the live activity.`)
      return
    }
    setState(current => ({ ...current, expenses: current.expenses.filter(item => item.id !== expense.id) }))
  }

  const deleteActivity = (group: ActivityGroup) => {
    if (!window.confirm(`Delete "${group.name}"? This removes the activity and all its expenses from this browser. This cannot be undone.`)) return
    const deletingSelectedActivity = selectedGroup?.id === group.id
    const deletingOpenLiveActivity = bookmarkedLiveGroupId === group.id
    setState(current => {
      const groups = current.groups.filter(item => item.id !== group.id)
      const remainingMemberIds = new Set(groups.flatMap(item => item.memberIds))
      return {
        ...current,
        groups,
        friends: current.friends.filter(friend => remainingMemberIds.has(friend.id)),
        expenses: current.expenses.filter(expense => expense.groupId !== group.id),
        selectedGroupId: deletingSelectedActivity ? groups[0]?.id ?? null : current.selectedGroupId,
      }
    })
    setActivityFeedback(null)
    live.removeBookmark(group.id)
    if (deletingOpenLiveActivity) closeLiveActivity()
    if (deletingSelectedActivity) setQuery('')
  }

  const resetData = () => {
    if (!window.confirm('Reset every local activity, friend, and expense? This cannot be undone.')) return
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
            <section className="shared-preview live-preview" aria-label="Live activity">
              <div><strong className={displayedLiveNotice && !live.session ? 'live-error' : undefined}>{live.session ? `Live activity · ${live.session.record.code}` : 'Opening live activity'}</strong><span role={displayedLiveNotice ? 'status' : undefined}>{live.saving ? 'Saving your change…' : displayedLiveNotice ?? (live.loading ? 'Loading the latest version…' : 'Everyone with this private link can edit.')}</span></div>
              <div>{bookmarkedLiveGroupId ? null : <button className="outline-button" onClick={closeLiveActivity}>Back to my activities</button>}{live.client ? <button className="confirm-button" onClick={live.refresh} disabled={live.loading}>{live.loading ? 'Loading…' : 'Refresh latest'}</button> : null}</div>
            </section>
            {liveActivity ? (
              <GroupDashboard
                group={liveActivity.group}
                members={liveMembers}
                expenses={liveActivity.expenses}
                query={query}
                activityFeedback={null}
                currentUserLabel={getSharedActivitySender(liveActivity).name}
                currentUserRole="Activity creator"
                statusLabel={`Live · revision ${live.session!.record.revision}`}
                shareQrLabel="Show QR"
                onShareQr={openCurrentLiveQr}
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
            <section className="shared-preview" aria-label="Shared activity preview">
              <div><strong>Shared activity snapshot</strong><span>This read-only link has not changed your local activities. Choose who you are before saving.</span></div>
              <div><button className="outline-button" onClick={closeSharedActivity}>Back to my activities</button><button className="confirm-button" onClick={() => setModal('shared-identity')}>Save a local copy</button></div>
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
      {modal === 'friend' ? <AddFriendModal existingExpenseCount={spendingExpenses(activeExpenses).length} onClose={() => setModal(null)} onSave={addFriends} /> : null}
      {modal === 'expense' && activeGroup ? (
        <ExpenseModal
          group={activeGroup}
          members={activeMembers}
          expense={editingExpense ?? undefined}
          onClose={closeExpenseModal}
          onSave={editingExpense ? updateExpense : addExpense}
        />
      ) : null}
      {modal === 'settlement' && activeGroup && settlingDirection ? <SettleUpModal group={activeGroup} settlement={settlingDirection} onClose={closeSettleUpModal} onSave={recordSettlement} /> : null}
      {modal === 'shared-identity' && sharedActivity ? <SharedActivityIdentityModal members={sharedMembers} onClose={() => setModal(null)} onSave={viewerId => saveSharedActivity(sharedActivity, viewerId)} /> : null}
      {modal === 'join' ? <JoinActivityModal onClose={() => setModal(null)} onJoin={joinSharedActivity} /> : null}
      {qrShare ? <Suspense fallback={null}><ShareActivityQrModal groupName={qrShare.activity.group.name} url={qrShare.url} mode={qrShare.mode} activityCode={qrShare.activityCode} onClose={() => setQrShare(null)} onCopy={() => copyQrLink(qrShare)} onShare={() => shareQrLink(qrShare)} /></Suspense> : null}
      {!identity || modal === 'identity' ? <IdentityModal initialName={identity?.name} onClose={identity ? () => setModal(null) : undefined} onSave={name => { setIdentity(createIdentity(name)); setModal(null) }} /> : null}
    </div>
  )
}
