import { describe, expect, it } from 'vitest'
import type { ActivityGroup, Expense, Member, PersistedState } from '../../domain/models'
import {
  addLocalExpense,
  addLocalFriends,
  createActivityFriends,
  createLocalActivity,
  deleteLocalActivity,
  deleteLocalExpense,
  updateLocalActivityCurrency,
  updateLocalExpense,
} from './activityState'

const maya: Member = { id: 'maya', name: 'Maya Chen', initials: 'MC', color: '#abc' }
const sam: Member = { id: 'sam', name: 'Sam', initials: 'S', color: '#def' }
const trip: ActivityGroup = { id: 'trip', name: 'Trip', emoji: '✦', memberIds: ['me', maya.id] }
const home: ActivityGroup = { id: 'home', name: 'Home', emoji: '⌂', memberIds: ['me', maya.id, sam.id] }
const dinner: Expense = {
  id: 'dinner',
  groupId: trip.id,
  title: 'Dinner',
  amount: 30,
  payerId: 'me',
  splitMethod: 'equal',
  shares: { me: 15, [maya.id]: 15 },
  createdAt: 'Today',
}
const state: PersistedState = {
  groups: [trip, home],
  friends: [maya, sam],
  expenses: [dinner],
  selectedGroupId: trip.id,
}

describe('local activity state operations', () => {
  it('creates activities and friends with complete relationships', () => {
    const friends = createActivityFriends(['Avery Stone'], 1)
    expect(friends[0]).toMatchObject({ name: 'Avery Stone', initials: 'AS' })

    const created = createLocalActivity(state, 'Cabin', ['Jordan Lee'])
    expect(created.groups).toHaveLength(3)
    expect(created.groups[2]).toMatchObject({ name: 'Cabin', memberIds: ['me', created.friends[2].id], currency: 'USD' })
    expect(created.selectedGroupId).toBe(created.groups[2].id)

    const yuanActivity = createLocalActivity(state, 'Shanghai', [], 'CNY')
    expect(yuanActivity.groups[2].currency).toBe('CNY')
  })

  it('updates currency only for an existing activity', () => {
    expect(updateLocalActivityCurrency(state, trip.id, 'EUR').groups).toEqual([
      { ...trip, currency: 'EUR' },
      home,
    ])
    expect(updateLocalActivityCurrency(state, 'missing', 'EUR')).toBe(state)
  })

  it('adds friends only to an existing activity', () => {
    const unchanged = addLocalFriends(state, 'missing', ['Jordan'])
    expect(unchanged).toBe(state)

    const updated = addLocalFriends(state, trip.id, ['Jordan'])
    const newFriend = updated.friends[2]
    expect(updated.groups[0].memberIds).toContain(newFriend.id)
    expect(updated.groups[1]).toBe(home)
  })

  it('adds, updates, and deletes expenses immutably', () => {
    const parking = { ...dinner, id: 'parking', title: 'Parking' }
    const added = addLocalExpense(state, parking)
    expect(added.expenses).toEqual([parking, dinner])

    const edited = { ...dinner, amount: 60 }
    expect(updateLocalExpense(added, edited).expenses).toEqual([parking, edited])
    expect(deleteLocalExpense(added, parking.id).expenses).toEqual([dinner])
  })

  it('deletes activity-owned data while preserving shared friends and selection', () => {
    const withoutTrip = deleteLocalActivity(state, trip.id)
    expect(withoutTrip).toEqual({ groups: [home], friends: [maya, sam], expenses: [], selectedGroupId: home.id })

    const withoutHome = deleteLocalActivity(state, home.id)
    expect(withoutHome).toEqual({ groups: [trip], friends: [maya], expenses: [dinner], selectedGroupId: trip.id })

    const noExplicitSelection = deleteLocalActivity({ ...state, selectedGroupId: null }, trip.id)
    expect(noExplicitSelection.selectedGroupId).toBe(home.id)

    expect(deleteLocalActivity({ groups: [], friends: [], expenses: [], selectedGroupId: null }, 'missing'))
      .toEqual({ groups: [], friends: [], expenses: [], selectedGroupId: null })
  })
})
