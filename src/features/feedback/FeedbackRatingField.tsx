import { Star } from 'lucide-react'
import { useId } from 'react'
import { useLocalization } from '../../i18n/LocalizationContext'
import { FEEDBACK_RATINGS, type FeedbackRating } from './feedbackApi'

export function FeedbackRatingField({
  compact = false,
  disabled = false,
  onChange,
  value,
}: {
  compact?: boolean
  disabled?: boolean
  onChange: (rating: FeedbackRating) => void
  value: FeedbackRating | null
}) {
  const { t } = useLocalization()
  const name = `feedback-rating-${useId()}`

  return (
    <fieldset className={`feedback-rating${compact ? ' feedback-rating--compact' : ''}`}>
      <legend>{t('feedbackForm.rating')}</legend>
      <div className="feedback-rating-options">
        {FEEDBACK_RATINGS.map(rating => (
          <label className={value !== null && rating <= value ? 'is-filled' : ''} key={rating}>
            <input
              type="radio"
              name={name}
              value={rating}
              checked={value === rating}
              onChange={() => onChange(rating)}
              aria-label={t('feedbackForm.ratingValue', { rating })}
              disabled={disabled}
            />
            <Star size={23} aria-hidden="true" />
          </label>
        ))}
      </div>
      <div className="feedback-rating-labels" aria-hidden="true">
        <span>{t('feedbackForm.ratingLow')}</span>
        <span>{t('feedbackForm.ratingHigh')}</span>
      </div>
    </fieldset>
  )
}
