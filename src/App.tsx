'use client'

import { useEffect, useState } from 'react'
import { FreshStart, Sidebar, Topbar } from './components/AppShell'
import { EMPTY_STATE } from './data/storage'
import { ACTIVITY_EMOJIS, addedFriendsMessage, CURRENT_USER, FRIEND_COLORS, initialsFor, makeId } from './domain/members'
import type { ActivityGroup, Expense, Member } from './domain/models'
import { GroupDashboard } from './features/activity/ActivityDashboard'
import { AddFriendModal, CreateGroupModal, ExpenseModal } from './features/activity/ActivityModals'
import { exportActivitySummary, SHARE_MESSAGES } from './features/sharing/shareActivity'
import {
  clearSharedActivityHash,
  createSharedActivity,
  decodeSharedActivityHash,
  saveSharedActivityCopy,
  shareActivityUrl,
  SHARE_URL_MESSAGES,
} from './features/sharing/shareActivityUrl'
import { usePersistedState } from './hooks/usePersistedState'

type ModalType = 'group' | 'friend' | 'expense' | null
type ActivityFeedback = { groupId: string; message: string } | null

function createFriends(names: string[], colorOffset: number): Member[] {
  return names.map((name, index) => ({
    id: makeId('friend'),
    name,
    initials: initialsFor(name),
    color: FRIEND_COLORS[(colorOffset + index) % FRIEND_COLORS.length],
  }))
}

export default function App() {
  const [state, setState] = usePersistedState()
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<ModalType>(null)
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null)
  const [activityFeedback, setActivityFeedback] = useState<ActivityFeedback>(null)
  const [sharedActivity, setSharedActivity] = useState(() => decodeSharedActivityHash(window.location.hash))

  useEffect(() => {
    const syncSharedActivity = () => setSharedActivity(decodeSharedActivityHash(window.location.hash))
    window.addEventListener('hashchange', syncSharedActivity)
    return () => window.removeEventListener('hashchange', syncSharedActivity)
  }, [])

  const selectedGroup = state.groups.find(group => group.id === state.selectedGroupId) ?? state.groups[0] ?? null
  const selectedMembers = selectedGroup
    ? [CURRENT_USER, ...state.friends.filter(friend => selectedGroup.memberIds.includes(friend.id))]
    : [CURRENT_USER]
  const selectedExpenses = selectedGroup
    ? state.expenses.filter(expense => expense.groupId === selectedGroup.id)
    : []
  const sharedMembers = sharedActivity ? [CURRENT_USER, ...sharedActivity.friends] : []

  const closeSharedActivity = () => {
    clearSharedActivityHash()
    setSharedActivity(null)
  }

  const saveSharedActivity = (activity: NonNullable<typeof sharedActivity>) => {
    setState(current => saveSharedActivityCopy(current, activity))
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

  const addFriends = (names: string[]) => {
    if (!selectedGroup) return
    const existingExpenseCount = selectedExpenses.length
    setState(current => {
      const newFriends = createFriends(names, current.friends.length)
      return {
        ...current,
        friends: [...current.friends, ...newFriends],
        groups: current.groups.map(group => group.id === selectedGroup.id
          ? { ...group, memberIds: [...group.memberIds, ...newFriends.map(friend => friend.id)] }
          : group),
      }
    })
    setActivityFeedback({ groupId: selectedGroup.id, message: addedFriendsMessage(names, existingExpenseCount) })
    setModal(null)
  }

  const addExpense = (expense: Expense) => {
    setState(current => ({ ...current, expenses: [expense, ...current.expenses] }))
    setEditingExpense(null)
    setModal(null)
  }

  const updateExpense = (expense: Expense) => {
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

  const shareGroupLink = async (group: ActivityGroup, members: Member[], expenses: Expense[]) => {
    const result = await shareActivityUrl(createSharedActivity(group, members, expenses))
    setActivityFeedback({ groupId: group.id, message: SHARE_URL_MESSAGES[result] })
  }

  const deleteExpense = (expense: Expense) => {
    if (!window.confirm(`Delete "${expense.title}"? This removes it from the activity and recalculates everyone’s balances.`)) return
    setState(current => ({ ...current, expenses: current.expenses.filter(item => item.id !== expense.id) }))
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
        selectedId={sharedActivity ? null : selectedGroup?.id ?? null}
        onSelect={id => {
          closeSharedActivity()
          setState(current => ({ ...current, selectedGroupId: id }))
        }}
        onCreate={() => {
          closeSharedActivity()
          setModal('group')
        }}
        onReset={resetData}
      />
      <div className="workspace">
        <Topbar query={query} setQuery={setQuery} />
        {sharedActivity ? (
          <>
            <section className="shared-preview" aria-label="Shared activity preview">
              <div><strong>Shared activity snapshot</strong><span>This link has not changed your local activities. “You” refers to the link creator in this prototype.</span></div>
              <div><button className="outline-button" onClick={closeSharedActivity}>Back to my activities</button><button className="confirm-button" onClick={() => saveSharedActivity(sharedActivity)}>Save a local copy</button></div>
            </section>
            <GroupDashboard
              group={sharedActivity.group}
              members={sharedMembers}
              expenses={sharedActivity.expenses}
              query={query}
              activityFeedback={null}
              readOnly
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
            onShareLink={() => shareGroupLink(selectedGroup, selectedMembers, selectedExpenses)}
            onAddFriend={() => setModal('friend')}
            onAddExpense={openNewExpense}
            onEditExpense={openEditExpense}
            onDeleteExpense={deleteExpense}
          />
        ) : <FreshStart onCreate={() => setModal('group')} />}
      </div>
      {modal === 'group' ? <CreateGroupModal onClose={() => setModal(null)} onSave={createGroup} /> : null}
      {modal === 'friend' ? <AddFriendModal existingExpenseCount={selectedExpenses.length} onClose={() => setModal(null)} onSave={addFriends} /> : null}
      {modal === 'expense' && selectedGroup ? (
        <ExpenseModal
          group={selectedGroup}
          members={selectedMembers}
          expense={editingExpense ?? undefined}
          onClose={closeExpenseModal}
          onSave={editingExpense ? updateExpense : addExpense}
        />
      ) : null}
    </div>
  )
}
