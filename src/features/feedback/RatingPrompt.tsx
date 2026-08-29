import { MessageSquareText, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/Button'
import type { AnalyticsSurface } from '../../analytics'
import { useLocalization } from '../../i18n/LocalizationContext'
import type { TranslationKey } from '../../i18n/localization'
import { FeedbackRatingField } from './FeedbackRatingField'
import { FeedbackApiError, type FeedbackClient, type FeedbackRating } from './feedbackApi'

function promptErrorKey(error: unknown) {
  return error instanceof FeedbackApiError && error.kind === 'rate-limit'
    ? 'feedbackForm.errorRateLimit' as const
    : 'feedbackForm.errorUnavailable' as const
}

function promptDescriptionKey(rating: FeedbackRating | null, trigger: 'share' | 'csv-export'): TranslationKey {
  if (rating !== null) return 'ratingPrompt.followUpDescription'
  return trigger === 'csv-export' ? 'ratingPrompt.csvExportDescription' : 'ratingPrompt.description'
}

export function RatingPrompt({
  client,
  onAddNote,
  onDismiss,
  onSubmitted,
  release,
  surface,
  trigger = 'share',
}: {
  client: Pick<FeedbackClient, 'submit'>
  onAddNote: (rating: FeedbackRating | null) => void
  onDismiss: () => void
  onSubmitted: () => void
  release: string
  surface: AnalyticsSurface
  trigger?: 'share' | 'csv-export'
}) {
  const { locale, t } = useLocalization()
  const [rating, setRating] = useState<FeedbackRating | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorKey, setErrorKey] = useState<'feedbackForm.errorRateLimit' | 'feedbackForm.errorUnavailable' | null>(null)

  const submitRating = async (selectedRating: FeedbackRating) => {
    setSubmitting(true)
    setErrorKey(null)
    try {
      await client.submit({
        category: 'general',
        message: '',
        locale,
        rating: selectedRating,
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
      <div className="rating-prompt-copy" aria-live="polite">
        <strong>{t(rating === null ? 'ratingPrompt.title' : 'ratingPrompt.followUpTitle')}</strong>
        <span>{t(promptDescriptionKey(rating, trigger))}</span>
      </div>
      <FeedbackRatingField
        compact
        value={rating}
        onChange={nextRating => {
          setRating(nextRating)
          setErrorKey(null)
        }}
        disabled={submitting}
      />
      {errorKey ? <p className="rating-prompt-error" role="alert">{t(errorKey)}</p> : null}
      {rating === null ? (
        <Button className="rating-prompt-note" onClick={() => onAddNote(null)} disabled={submitting}>
          <MessageSquareText size={15} />{t('ratingPrompt.addNote')}
        </Button>
      ) : (
        <div className="rating-prompt-actions">
          <Button variant="primary" className="rating-prompt-note" onClick={() => onAddNote(rating)} disabled={submitting}>
            <MessageSquareText size={15} />{t('ratingPrompt.addNote')}
          </Button>
          <Button onClick={() => void submitRating(rating)} disabled={submitting}>
            {t(submitting ? 'feedbackForm.sending' : 'ratingPrompt.sendRating')}
          </Button>
        </div>
      )}
    </section>
  )
}
