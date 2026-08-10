export const RATING_PROMPT_STORAGE_KEY = 'tally:feedback-rating-prompt:v1'

export function shouldShowRatingPrompt(release: string, storage: Pick<Storage, 'getItem'> = localStorage) {
  try {
    return storage.getItem(RATING_PROMPT_STORAGE_KEY) !== release
  } catch {
    return true
  }
}

export function markRatingPromptHandled(release: string, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(RATING_PROMPT_STORAGE_KEY, release)
  } catch {
    // Feedback prompts must never interfere with the activity.
  }
}
