export type Member = {
  id: string
  name: string
  initials: string
  color: string
}

export type ActivityGroup = {
  id: string
  name: string
  emoji: string
  memberIds: string[]
}

export type SplitMethod = 'equal' | 'exact'

export type Expense = {
  id: string
  groupId: string
  title: string
  amount: number
  payerId: string
  splitMethod: SplitMethod
  shares: Record<string, number>
  createdAt: string
}

export type PersistedState = {
  groups: ActivityGroup[]
  friends: Member[]
  expenses: Expense[]
  selectedGroupId: string | null
}

export type Settlement = {
  from: Member
  to: Member
  amount: number
}
