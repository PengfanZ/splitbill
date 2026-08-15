import { Bug, CircleAlert, Lightbulb, MessageCircleMore, Send, ShieldCheck } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../components/Button'
import { ModalShell } from '../../components/Dialog'
import { useLocalization } from '../../i18n/LocalizationContext'
import type { AnalyticsSurface } from '../../analytics'
import type { TranslationKey } from '../../i18n/localization'
import { FeedbackRatingField } from './FeedbackRatingField'
import {
  FeedbackApiError,
  type FeedbackCategory,
  type FeedbackClient,
  type FeedbackRating,
} from './feedbackApi'

const CATEGORY_OPTIONS = [
  { value: 'general', labelKey: 'feedbackForm.categoryGeneral', icon: MessageCircleMore },
  { value: 'idea', labelKey: 'feedbackForm.categoryIdea', icon: Lightbulb },
  { value: 'problem', labelKey: 'feedbackForm.categoryProblem', icon: Bug },
] as const satisfies ReadonlyArray<{
  value: FeedbackCategory
  labelKey: TranslationKey
  icon: typeof MessageCircleMore
}>

function feedbackErrorKey(error: unknown): TranslationKey {
  if (!(error instanceof FeedbackApiError)) return 'feedbackForm.errorUnavailable'
  if (error.kind === 'rate-limit') return 'feedbackForm.errorRateLimit'
  if (error.kind === 'invalid-input') return 'feedbackForm.errorInvalid'
  if (error.kind === 'network') return 'feedbackForm.errorNetwork'
  return 'feedbackForm.errorUnavailable'
}

export function FeedbackModal({
  client,
  initialRating = null,
  onClose,
  onSubmitted,
  release,
  surface,
}: {
  client: Pick<FeedbackClient, 'submit'> | null
  initialRating?: FeedbackRating | null
  onClose: () => void
  onSubmitted: () => void
  release: string
  surface: AnalyticsSurface
}) {
  const { locale, t } = useLocalization()
  const messageId = useId()
  const [category, setCategory] = useState<FeedbackCategory>('general')
  const [rating, setRating] = useState<FeedbackRating | null>(initialRating)
  const [message, setMessage] = useState('')
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const normalizedMessage = message.trim()
  const validMessage = normalizedMessage.length === 0 || normalizedMessage.length >= 3
  const canSubmit = validMessage && (rating !== null || normalizedMessage.length >= 3) && !submitting

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    if (!client) {
      setErrorKey('feedbackForm.errorUnavailable')
      return
    }

    setErrorKey(null)
    setSubmitting(true)
    try {
      await client.submit({ category, message, locale, rating, surface, release })
      onSubmitted()
    } catch (error) {
      setErrorKey(feedbackErrorKey(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell
      eyebrow={t('feedbackForm.eyebrow')}
      title={t('feedbackForm.title')}
      description={t('feedbackForm.description')}
      onClose={submitting ? undefined : onClose}
      mobilePlacement="center"
    >
      <form className="feedback-form" onSubmit={submit}>
        <FeedbackRatingField
          value={rating}
          onChange={nextRating => {
            setRating(nextRating)
            setErrorKey(null)
          }}
          disabled={submitting}
        />

        <fieldset className="feedback-category">
          <legend>{t('feedbackForm.category')}</legend>
          <div>
            {CATEGORY_OPTIONS.map(option => {
              const Icon = option.icon
              return (
                <label className={category === option.value ? 'is-selected' : ''} key={option.value}>
                  <input
                    type="radio"
                    name="feedback-category"
                    value={option.value}
                    checked={category === option.value}
                    onChange={() => setCategory(option.value)}
                    disabled={submitting}
                  />
                  <Icon size={16} />
                  <span>{t(option.labelKey)}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="feedback-message">
          <label htmlFor={messageId}>{t('feedbackForm.messageOptional')}</label>
          <textarea
            id={messageId}
            value={message}
            onChange={event => {
              setMessage(event.target.value)
              setErrorKey(null)
            }}
            placeholder={t('feedbackForm.placeholder')}
            maxLength={1000}
            autoFocus
            disabled={submitting}
          />
          <small aria-hidden="true">{message.length}/1000</small>
        </div>

        <p className="feedback-privacy"><ShieldCheck size={16} />{t('feedbackForm.privacy')}</p>
        {errorKey ? <p className="feedback-error" role="alert"><CircleAlert size={16} />{t(errorKey)}</p> : null}

        <div className="modal-actions">
          <Button onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" disabled={!canSubmit}>
            <Send size={16} />{t(submitting ? 'feedbackForm.sending' : 'feedbackForm.send')}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}
