import type { PersistedState } from '../domain/models'

export const STORAGE_KEY = 'tally:frontend:v2'
export const EMPTY_STATE: PersistedState = { groups: [], friends: [], expenses: [], selectedGroupId: null }

export function parseState(stored: string | null): PersistedState {
  try {
    if (!stored) return EMPTY_STATE
    const parsed = JSON.parse(stored) as Partial<PersistedState>
    if (!Array.isArray(parsed.groups) || !Array.isArray(parsed.friends) || !Array.isArray(parsed.expenses)) return EMPTY_STATE
    return {
      groups: parsed.groups,
      friends: parsed.friends,
      expenses: parsed.expenses,
      selectedGroupId: typeof parsed.selectedGroupId === 'string' ? parsed.selectedGroupId : parsed.groups[0]?.id ?? null,
    }
  } catch {
    return EMPTY_STATE
  }
}

export function loadState(): PersistedState {
  try {
    return parseState(localStorage.getItem(STORAGE_KEY))
  } catch {
    return EMPTY_STATE
  }
}

export function saveState(state: PersistedState) {
  try {
    const serialized = JSON.stringify(state)
    if (localStorage.getItem(STORAGE_KEY) !== serialized) localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // Keep the app usable when local storage is unavailable.
  }
}
