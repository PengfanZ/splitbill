import {
  ACTIVITY_IDENTITY_KEY,
  loadActivityIdentitySelections,
  parseActivityIdentitySelections,
  saveActivityIdentitySelections,
} from '../data/activityIdentity'
import { usePersistentStorageState } from './usePersistentStorageState'

export function useActivityIdentitySelections() {
  return usePersistentStorageState({
    key: ACTIVITY_IDENTITY_KEY,
    load: loadActivityIdentitySelections,
    parse: parseActivityIdentitySelections,
    save: saveActivityIdentitySelections,
  })
}
