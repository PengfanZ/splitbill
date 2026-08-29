export const RATING_PROMPT_STORAGE_KEY = 'tally:feedback-rating-prompt:v1'
export const CSV_EXPORT_RATING_PROMPT_STORAGE_KEY = 'tally:feedback-rating-prompt:csv-export:v1'

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

export function shouldShowCsvExportRatingPrompt(storage: Pick<Storage, 'getItem'> = localStorage) {
  try {
    return storage.getItem(CSV_EXPORT_RATING_PROMPT_STORAGE_KEY) !== 'handled'
  } catch {
    return true
  }
}

export function markCsvExportRatingPromptHandled(storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(CSV_EXPORT_RATING_PROMPT_STORAGE_KEY, 'handled')
  } catch {
    // Feedback prompts must never interfere with the export.
  }
}
