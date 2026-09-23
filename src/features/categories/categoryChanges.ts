import type { Dispatch, SetStateAction } from 'react'
import { activityCategories, changeCategories, type CategoryChange } from '../../domain/categories'
import type { ActivityGroup, Expense, PersistedState } from '../../domain/models'
import type { SharedActivity } from '../sharing/sharedActivity'
import type { ActivityFeedback } from '../sharing/useActivitySharing'

type CategoryChangeContext = {
  activeGroup: ActivityGroup | null | undefined
  activeExpenses: Expense[]
  liveActivity: SharedActivity | null
  editable: boolean
  saveLive: (snapshot: SharedActivity, message: string, mutationKey: string) => Promise<unknown>
  setState: Dispatch<SetStateAction<PersistedState>>
  setFeedback: (feedback: ActivityFeedback) => void
  message: string
}

export function categoryMutationEvent(group: ActivityGroup | null | undefined, change: CategoryChange) {
  if (change.kind === 'delete') return 'category_deleted'
  return activityCategories(group ?? {}).some(category => category.id === change.category.id) ? 'category_updated' : 'category_created'
}

/** Uses the existing live revision guard, or applies a local change against fresh state. */
export async function persistCategoryChange(context: CategoryChangeContext, change: CategoryChange) {
  const { activeGroup, activeExpenses, liveActivity, editable, saveLive, setState, setFeedback, message } = context
  if (!activeGroup || (liveActivity && !editable)) return false
  const changed = changeCategories(activeGroup, activeExpenses, change)
  if (!changed) return false
  if (liveActivity) return Boolean(await saveLive(
    { ...liveActivity, ...changed }, message, JSON.stringify(['categories', change]),
  ))
  setState(current => {
    const group = current.groups.find(item => item.id === activeGroup.id)
    if (!group) return current
    const next = changeCategories(group, current.expenses, change)
    return next ? { ...current, groups: current.groups.map(item => item.id === group.id ? next.group : item), expenses: next.expenses } : current
  })
  setFeedback({ groupId: activeGroup.id, message })
  return true
}
