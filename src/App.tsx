'use client'

import { lazy, Suspense, useEffect, useState } from 'react'
import { FreshStart, Sidebar, Topbar } from './components/AppShell'
import { createIdentity } from './data/identity'
import { EMPTY_STATE } from './data/storage'
import { ACTIVITY_EMOJIS, addedFriendsMessage, CURRENT_USER, FRIEND_COLORS, initialsFor, makeId } from './domain/members'
import type { ActivityGroup, Expense, Member } from './domain/models'
import { GroupDashboard } from './features/activity/ActivityDashboard'
import { AddFriendModal, CreateGroupModal, ExpenseModal } from './features/activity/ActivityModals'
import { IdentityModal } from './features/identity/IdentityModal'
import { LiveActivityApiError, type LiveActivityRecord } from './features/liveSharing/liveActivityApi'
import { createConfiguredLiveActivityClient, type LiveActivityClient } from './features/liveSharing/liveActivityConfig'
import { buildLiveActivityUrl, clearLiveActivityHash, parseLiveActivityHash, type LiveActivityCredentials } from './features/liveSharing/liveActivityLink'
import { exportActivitySummary, SHARE_MESSAGES } from './features/sharing/shareActivity'
import { SharedActivityIdentityModal } from './features/sharing/SharedActivityIdentityModal'
import {
  clearSharedActivityHash,
  buildSharedActivityQrUrl,
  createSharedActivity,
  decodeSharedActivityHash,
  getSharedActivitySender,
  saveSharedActivityCopy,
  shareActivityUrl,
  SHARE_URL_MESSAGES,
  type SharedActivity,
} from './features/sharing/shareActivityUrl'
import { usePersistedState } from './hooks/usePersistedState'
import { useIdentity } from './hooks/useIdentity'

type ModalType = 'group' | 'friend' | 'expense' | 'identity' | 'shared-identity' | null
type ActivityFeedback = { groupId: string; message: string } | null
type QrShare = { activity: SharedActivity; url: string; mode: 'snapshot' | 'live'; activityCode?: string } | null
type LiveSession = { credentials: LiveActivityCredentials; record: LiveActivityRecord }
type AppProps = { liveActivityClient?: LiveActivityClient | null }

const ShareActivityQrModal = lazy(() => import('./features/sharing/ShareActivityQrModal').then(module => ({ default: module.ShareActivityQrModal })))

function createFriends(names: string[], colorOffset: number): Member[] {
  return names.map((name, index) => ({
    id: makeId('friend'),
    name,
    initials: initialsFor(name),
    color: FRIEND_COLORS[(colorOffset + index) % FRIEND_COLORS.length],
  }))
}

function liveActivityErrorMessage(error: unknown) {
  if (error instanceof LiveActivityApiError) {
    if (error.kind === 'conflict') return 'Someone saved a newer version. Refresh the activity, then try your change again.'
    if (error.kind === 'not-found') return 'This live activity link is invalid or no longer available.'
    if (error.kind === 'network') return 'Could not reach the live activity service. Check your connection and try again.'
  }
  return 'The live activity could not be updated. Please try again.'
}

export default function App({ liveActivityClient }: AppProps = {}) {
  const [state, setState] = usePersistedState()
  const [identity, setIdentity] = useIdentity()
  const [liveClient] = useState(() => liveActivityClient === undefined ? createConfiguredLiveActivityClient() : liveActivityClient)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ModalType>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [activityFeedback, setActivityFeedback] = useState<ActivityFeedback>(null)
  const [qrShare, setQrShare] = useState<QrShare>(null)
  const [liveCredentials, setLiveCredentials] = useState(() => parseLiveActivityHash(window.location.hash))
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null)
  const [liveLoading, setLiveLoading] = useState(() => Boolean(parseLiveActivityHash(window.location.hash) && liveClient))
  const [liveSaving, setLiveSaving] = useState(false)
  const [liveNotice, setLiveNotice] = useState<string | null>(null)
  const [sharedActivity, setSharedActivity] = useState(() => parseLiveActivityHash(window.location.hash) ? null : decodeSharedActivityHash(window.location.hash))

  useEffect(() => {
    const syncSharedActivity = () => {
      const credentials = parseLiveActivityHash(window.location.hash)
      setLiveCredentials(credentials)
      setLiveSession(null)
      setLiveNotice(null)
      setLiveLoading(Boolean(credentials && liveClient))
      setSharedActivity(credentials ? null : decodeSharedActivityHash(window.location.hash))
    }
    window.addEventListener('hashchange', syncSharedActivity)
    return () => window.removeEventListener('hashchange', syncSharedActivity)
  }, [liveClient])

  useEffect(() => {
    if (!liveCredentials || !liveClient) return
    let active = true
    liveClient.load(liveCredentials).then(record => {
      if (!active) return
      setLiveSession({ credentials: liveCredentials, record })
      setLiveNotice(null)
    }).catch(error => {
      if (active) setLiveNotice(liveActivityErrorMessage(error))
    }).finally(() => {
      if (active) setLiveLoading(false)
    })
    return () => { active = false }
  }, [liveClient, liveCredentials])

  const selectedGroup = state.groups.find(group => group.id === state.selectedGroupId) ?? state.groups[0] ?? null
  const currentUser = identity ?? CURRENT_USER
  const selectedMembers = selectedGroup
    ? [currentUser, ...state.friends.filter(friend => selectedGroup.memberIds.includes(friend.id))]
    : [currentUser]
  const selectedExpenses = selectedGroup
    ? state.expenses.filter(expense => expense.groupId === selectedGroup.id)
    : []
  const sharedMembers = sharedActivity ? [getSharedActivitySender(sharedActivity), ...sharedActivity.friends] : []
  const liveActivity = liveSession?.record.snapshot ?? null
  const liveMembers = liveActivity ? [getSharedActivitySender(liveActivity), ...liveActivity.friends] : []
  const activeGroup = liveActivity?.group ?? selectedGroup
  const activeMembers = liveActivity ? liveMembers : selectedMembers
  const activeExpenses = liveActivity?.expenses ?? selectedExpenses
  const displayedLiveNotice = liveNotice ?? (!liveClient && liveCredentials ? 'Live sharing is not configured in this build.' : null)

  const closeSharedActivity = () => {
    clearSharedActivityHash()
    setSharedActivity(null)
    setModal(null)
  }

  const closeLiveActivity = () => {
    clearLiveActivityHash()
    setLiveCredentials(null)
    setLiveSession(null)
    setLiveNotice(null)
    setModal(null)
  }

  const closeSharedViews = () => {
    if (liveCredentials) closeLiveActivity()
    else closeSharedActivity()
  }

  const refreshLiveActivity = async () => {
    const client = liveClient!
    const credentials = liveCredentials!
    setLiveLoading(true)
    try {
      const record = await client.load(credentials)
      setLiveSession({ credentials, record })
      setLiveNotice('Latest changes loaded.')
    } catch (error) {
      setLiveNotice(liveActivityErrorMessage(error))
    } finally {
      setLiveLoading(false)
    }
  }

  const saveLiveActivity = async (snapshot: SharedActivity, successMessage: string) => {
    const client = liveClient!
    const session = liveSession!
    setLiveSaving(true)
    try {
      const record = await client.update(session.credentials, snapshot, session.record.revision)
      setLiveSession({ credentials: session.credentials, record })
      setLiveNotice(successMessage)
      return true
    } catch (error) {
      setLiveNotice(liveActivityErrorMessage(error))
      return false
    } finally {
      setLiveSaving(false)
    }
  }

  const saveSharedActivity = (activity: NonNullable<typeof sharedActivity>, viewerId: string) => {
    setState(current => saveSharedActivityCopy(current, activity, viewerId))
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
    setModal(null)
  }

  const addFriends = async (names: string[]) => {
    if (!activeGroup) return
    const existingExpenseCount = activeExpenses.length
    if (liveActivity) {
      const newFriends = createFriends(names, liveActivity.friends.length)
      const saved = await saveLiveActivity({
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
      const saved = await saveLiveActivity({ ...liveActivity, expenses: [expense, ...liveActivity.expenses] }, `${expense.title} was added to the live activity.`)
      if (saved) closeExpenseModal()
      return
    }
    setState(current => ({ ...current, expenses: [expense, ...current.expenses] }))
    setEditingExpense(null)
    setModal(null)
  }

  const updateExpense = async (expense: Expense) => {
    if (liveActivity) {
      const saved = await saveLiveActivity({
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
    if (!liveClient) {
      setActivityFeedback({ groupId: group.id, message: 'Live sharing is not configured in this build.' })
      return
    }
    setActivityFeedback({ groupId: group.id, message: 'Creating a private live activity link…' })
    const activity = createSharedActivity(group, members, expenses)
    try {
      const created = await liveClient.create(activity)
      const credentials = { code: created.code, editToken: created.editToken }
      setQrShare({ activity, url: buildLiveActivityUrl(credentials), mode: 'live', activityCode: created.code })
      setActivityFeedback({ groupId: group.id, message: `Live activity ${created.code} is ready to share.` })
    } catch (error) {
      setActivityFeedback({ groupId: group.id, message: liveActivityErrorMessage(error) })
    }
  }

  const openCurrentLiveQr = () => {
    const session = liveSession!
    setQrShare({
      activity: session.record.snapshot,
      url: buildLiveActivityUrl(session.credentials),
      mode: 'live',
      activityCode: session.record.code,
    })
  }

  const copyQrLink = async (share: NonNullable<QrShare>) => {
    if (share.mode === 'live') {
      try {
        await navigator.clipboard.writeText(share.url)
        setQrShare(null)
        if (liveSession) setLiveNotice('Live activity link copied. Anyone with it can edit this activity.')
        else setActivityFeedback({ groupId: share.activity.group.id, message: 'Live activity link copied.' })
      } catch {
        const message = 'Could not copy the live activity link. Copy it from the browser address bar instead.'
        if (liveSession) setLiveNotice(message)
        else setActivityFeedback({ groupId: share.activity.group.id, message })
      }
      return
    }
    const result = await shareActivityUrl(share.activity)
    setQrShare(null)
    setActivityFeedback({ groupId: share.activity.group.id, message: SHARE_URL_MESSAGES[result] })
  }

  const deleteExpense = async (expense: Expense) => {
    if (!window.confirm(`Delete "${expense.title}"? This removes it from the activity and recalculates everyone’s balances.`)) return
    if (liveActivity) {
      await saveLiveActivity({ ...liveActivity, expenses: liveActivity.expenses.filter(item => item.id !== expense.id) }, `${expense.title} was deleted from the live activity.`)
      return
    }
    setState(current => ({ ...current, expenses: current.expenses.filter(item => item.id !== expense.id) }))
  }

  const deleteActivity = (group: ActivityGroup) => {
    if (!window.confirm(`Delete "${group.name}"? This removes the activity and all its expenses from this browser. This cannot be undone.`)) return
    const deletingSelectedActivity = selectedGroup?.id === group.id
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
    if (deletingSelectedActivity) setQuery('')
  }

  const resetData = () => {
    if (!window.confirm('Reset every local activity, friend, and expense? This cannot be undone.')) return
    setState(EMPTY_STATE)
    setQuery('')
  }

  return (
    <div className="app-shell">
      <Sidebar
        groups={state.groups}
        selectedId={sharedActivity || liveCredentials ? null : selectedGroup?.id ?? null}
        onSelect={id => {
          closeSharedViews()
          setState(current => ({ ...current, selectedGroupId: id }))
        }}
        onCreate={() => {
          closeSharedViews()
          setModal('group')
        }}
        onDelete={deleteActivity}
        onReset={resetData}
      />
      <div className="workspace">
        <Topbar query={query} setQuery={setQuery} onSettings={() => setModal('identity')} />
        {liveCredentials ? (
          <>
            <section className="shared-preview live-preview" aria-label="Live activity">
              <div><strong className={displayedLiveNotice && !liveSession ? 'live-error' : undefined}>{liveSession ? `Live activity · ${liveSession.record.code}` : 'Opening live activity'}</strong><span role={displayedLiveNotice ? 'status' : undefined}>{liveSaving ? 'Saving your change…' : displayedLiveNotice ?? (liveLoading ? 'Loading the latest version…' : 'Everyone with this private link can edit.')}</span></div>
              <div><button className="outline-button" onClick={closeLiveActivity}>Back to my activities</button>{liveClient ? <button className="confirm-button" onClick={refreshLiveActivity} disabled={liveLoading}>{liveLoading ? 'Loading…' : 'Refresh latest'}</button> : null}</div>
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
                statusLabel={`Live · revision ${liveSession!.record.revision}`}
                shareQrLabel="Show QR"
                onShareQr={openCurrentLiveQr}
                onShare={() => shareGroup(liveActivity.group, liveMembers, liveActivity.expenses)}
                onAddFriend={() => setModal('friend')}
                onAddExpense={openNewExpense}
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
            onEditExpense={openEditExpense}
            onDeleteExpense={deleteExpense}
          />
        ) : <FreshStart onCreate={() => setModal('group')} />}
      </div>
      {modal === 'group' ? <CreateGroupModal onClose={() => setModal(null)} onSave={createGroup} /> : null}
      {modal === 'friend' ? <AddFriendModal existingExpenseCount={activeExpenses.length} onClose={() => setModal(null)} onSave={addFriends} /> : null}
      {modal === 'expense' && activeGroup ? (
        <ExpenseModal
          group={activeGroup}
          members={activeMembers}
          expense={editingExpense ?? undefined}
          onClose={closeExpenseModal}
          onSave={editingExpense ? updateExpense : addExpense}
        />
      ) : null}
      {modal === 'shared-identity' && sharedActivity ? <SharedActivityIdentityModal members={sharedMembers} onClose={() => setModal(null)} onSave={viewerId => saveSharedActivity(sharedActivity, viewerId)} /> : null}
      {qrShare ? <Suspense fallback={null}><ShareActivityQrModal groupName={qrShare.activity.group.name} url={qrShare.url} mode={qrShare.mode} activityCode={qrShare.activityCode} onClose={() => setQrShare(null)} onCopy={() => copyQrLink(qrShare)} /></Suspense> : null}
      {!identity || modal === 'identity' ? <IdentityModal initialName={identity?.name} onClose={identity ? () => setModal(null) : undefined} onSave={name => { setIdentity(createIdentity(name)); setModal(null) }} /> : null}
    </div>
  )
}
