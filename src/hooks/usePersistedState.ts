import { useEffect, useState } from 'react'
import { loadState, parseState, saveState, STORAGE_KEY } from '../data/storage'
import type { PersistedState } from '../domain/models'

export function usePersistedState() {
  const [state, setState] = useState<PersistedState>(() => loadState())

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setState(parseState(event.newValue))
    }
    window.addEventListener('storage', syncAcrossTabs)
    return () => window.removeEventListener('storage', syncAcrossTabs)
  }, [])

  return [state, setState] as const
}
