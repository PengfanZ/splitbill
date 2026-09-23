import { expect, it, vi } from 'vitest'
import type { SetStateAction } from 'react'
import { categoryMutationEvent, persistCategoryChange } from './categoryChanges'
import { CATEGORY_COLORS } from '../../domain/categories'
import type { PersistedState } from '../../domain/models'
import { CURRENT_USER } from '../../domain/members'
import { createSharedActivity } from '../sharing/sharedActivity'

const group = { id: 'trip', name: 'Trip', emoji: '☀', memberIds: ['me'] }
const category = { id: 'coffee', name: 'Coffee', color: CATEGORY_COLORS[0] }
const change = { kind: 'save' as const, category }
it('classifies category mutations without exposing category details', () => {
  expect(categoryMutationEvent(undefined, change)).toBe('category_created')
  expect(categoryMutationEvent(group, change)).toBe('category_created')
  expect(categoryMutationEvent({ ...group, categories: [category] }, change)).toBe('category_updated')
  expect(categoryMutationEvent(group, { kind: 'delete', id: category.id })).toBe('category_deleted')
})
function fixture() {
  let state: PersistedState = { groups: [group, { ...group, id: 'other' }], expenses: [], friends: [], selectedGroupId: 'trip' }
  const context = {
    activeGroup: group, activeExpenses: [], liveActivity: null, editable: true,
    saveLive: vi.fn().mockResolvedValue(true), setFeedback: vi.fn(), message: 'Saved',
    setState: vi.fn((update: SetStateAction<PersistedState>) => { state = typeof update === 'function' ? update(state) : update }),
  }
  return { context, getState: () => state }
}

it('rejects absent activities, offline live sessions and invalid changes without side effects', async () => {
  const { context } = fixture()
  expect(await persistCategoryChange({ ...context, activeGroup: null }, change)).toBe(false)
  const liveActivity = createSharedActivity(group, [CURRENT_USER], [])
  expect(await persistCategoryChange({ ...context, liveActivity, editable: false }, change)).toBe(false)
  expect(await persistCategoryChange(context, { ...change, category: { ...category, name: 'General' } })).toBe(false)
  expect(context.setState).not.toHaveBeenCalled()
  expect(context.saveLive).not.toHaveBeenCalled()
  expect(context.setFeedback).not.toHaveBeenCalled()
})

it('updates only the target local activity and preserves newer state when the target disappears or changes', async () => {
  const { context, getState } = fixture()
  expect(await persistCategoryChange(context, change)).toBe(true)
  expect(getState().groups[0].categories).toContainEqual(category)
  expect(getState().groups[1]).toEqual({ ...group, id: 'other' })
  const initial = getState()
  const updater = context.setState.mock.calls[0][0] as (state: PersistedState) => PersistedState
  const removed = { ...initial, groups: [] }
  expect(updater(removed)).toBe(removed)
  const duplicate = { ...initial, groups: [{ ...group, categories: [{ ...category, id: 'other-coffee' }] }] }
  expect(updater(duplicate)).toBe(duplicate)
})

it('delegates live updates to revision-aware saving and propagates failed saves', async () => {
  const { context } = fixture()
  const liveActivity = createSharedActivity(group, [CURRENT_USER], [])
  expect(await persistCategoryChange({ ...context, liveActivity }, change)).toBe(true)
  expect(context.saveLive).toHaveBeenCalledWith(expect.objectContaining({ group: expect.objectContaining({ categories: expect.arrayContaining([category]) }) }), 'Saved', JSON.stringify(['categories', change]))
  context.saveLive.mockResolvedValue(false)
  expect(await persistCategoryChange({ ...context, liveActivity }, change)).toBe(false)
  expect(context.setState).not.toHaveBeenCalled()
  expect(context.setFeedback).not.toHaveBeenCalled()
})
