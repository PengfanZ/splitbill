import { MessageSquareText, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/Button'
import type { AnalyticsSurface } from '../../analytics'
import { useLocalization } from '../../i18n/LocalizationContext'
import { FeedbackRatingField } from './FeedbackRatingField'
import { FeedbackApiError, type FeedbackClient, type FeedbackRating } from './feedbackApi'

function promptErrorKey(error: unknown) {
  return error instanceof FeedbackApiError && error.kind === 'rate-limit'
    ? 'feedbackForm.errorRateLimit' as const
    : 'feedbackForm.errorUnavailable' as const
}

export function RatingPrompt({
  client,
  onAddNote,
  onDismiss,
  onSubmitted,
  release,
  surface,
}: {
  client: Pick<FeedbackClient, 'submit'>
  onAddNote: () => void
  onDismiss: () => void
  onSubmitted: () => void
  release: string
  surface: AnalyticsSurface
}) {
  const { locale, t } = useLocalization()
  const [rating, setRating] = useState<FeedbackRating | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorKey, setErrorKey] = useState<'feedbackForm.errorRateLimit' | 'feedbackForm.errorUnavailable' | null>(null)

  const submitRating = async (nextRating: FeedbackRating) => {
    setRating(nextRating)
    setSubmitting(true)
    setErrorKey(null)
    try {
      await client.submit({
        category: 'general',
        message: '',
        locale,
        rating: nextRating,
        release,
        surface,
      })
      onSubmitted()
    } catch (error) {
      setErrorKey(promptErrorKey(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rating-prompt" aria-label={t('ratingPrompt.title')}>
      <button className="rating-prompt-close" onClick={onDismiss} disabled={submitting} aria-label={t('common.close')}>
        <X size={18} />
      </button>
      <div className="rating-prompt-copy">
        <strong>{t('ratingPrompt.title')}</strong>
        <span>{t('ratingPrompt.description')}</span>
      </div>
      <FeedbackRatingField compact value={rating} onChange={submitRating} disabled={submitting} />
      {errorKey ? <p className="rating-prompt-error" role="alert">{t(errorKey)}</p> : null}
      <Button className="rating-prompt-note" onClick={onAddNote} disabled={submitting}>
        <MessageSquareText size={15} />{t('ratingPrompt.addNote')}
      </Button>
    </section>
  )
}
