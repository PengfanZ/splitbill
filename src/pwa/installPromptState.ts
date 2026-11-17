export const INSTALL_PROMPT_STORAGE_KEY = 'tally:install-prompt:v1'

/** The prompt is offered once: it becomes pending at the first activity created in this browser, and done when closed. */
export function isInstallPromptPending(storage: Pick<Storage, 'getItem'> = localStorage) {
  try {
    return storage.getItem(INSTALL_PROMPT_STORAGE_KEY) === 'pending'
  } catch {
    // Without storage the prompt could not be dismissed for good, so don't show it.
    return false
  }
}

/** Marks the prompt pending unless it was already offered. Returns whether it is pending now. */
export function markInstallPromptPending(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  try {
    if (storage.getItem(INSTALL_PROMPT_STORAGE_KEY) === null) storage.setItem(INSTALL_PROMPT_STORAGE_KEY, 'pending')
  } catch {
    return false
  }
  return isInstallPromptPending(storage)
}

export function markInstallPromptDone(storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(INSTALL_PROMPT_STORAGE_KEY, 'done')
  } catch {
    // The prompt still closes for this visit.
  }
}
