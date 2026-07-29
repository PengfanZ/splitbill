import { loadState, parseState, saveState, STORAGE_KEY } from '../data/storage'
import { usePersistentStorageState } from './usePersistentStorageState'

export function usePersistedState() {
  return usePersistentStorageState({
    key: STORAGE_KEY,
    load: loadState,
    parse: parseState,
    save: saveState,
  })
}
