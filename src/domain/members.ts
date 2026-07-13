import type { Member } from './models'

export const CURRENT_USER: Member = {
  id: 'me',
  name: 'You',
  initials: 'ME',
  color: '#ead1b9',
}

export const FRIEND_COLORS = ['#d6e8dc', '#f6d5bd', '#d8dde8', '#f3d9da', '#d7e6ee', '#f1dda9']
export const ACTIVITY_EMOJIS = ['✦', '⌂', '☀', '✈']

export const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const initialsFor = (name: string) => name
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map(part => part[0]?.toUpperCase())
  .join('') || '?'

export function addedFriendsMessage(names: string[], existingExpenseCount: number) {
  const people = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const added = names.length === 1 ? 'was added' : 'were added'
  if (!existingExpenseCount) return `${people} ${added} to the activity.`
  const expense = existingExpenseCount === 1 ? 'expense was' : 'expenses were'
  return `${people} ${added} for future expenses. ${existingExpenseCount} earlier ${expense} left unchanged.`
}
