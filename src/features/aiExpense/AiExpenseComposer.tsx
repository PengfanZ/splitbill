import { useState } from 'react'
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '../../components/Button'
import type { CurrencyCode } from '../../domain/currency'
import type { Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'
import { AiExpenseApiError, type AiExpenseClient } from './aiExpenseApi'
import {
  AI_EXPENSE_TEXT_MAX_LENGTH,
  type AiExpenseReadyDraft,
} from './aiExpenseContract'

function errorTranslationKey(error: unknown) {
  if (!(error instanceof AiExpenseApiError)) return 'expense.aiError'
  if (error.kind === 'rate-limit') return 'expense.aiRateLimit'
  if (error.kind === 'invalid-input') return 'expense.aiInvalid'
  return 'expense.aiError'
}

export function AiExpenseComposer({
  client,
  currency,
  members,
  onClose,
  onDraft,
}: {
  client: AiExpenseClient
  currency: CurrencyCode
  members: Member[]
  onClose: () => void
  onDraft: (draft: AiExpenseReadyDraft) => void
}) {
  const { locale, t } = useLocalization()
  const [text, setText] = useState('')
  const [clarification, setClarification] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [errorKey, setErrorKey] = useState<ReturnType<typeof errorTranslationKey> | null>(null)
  const [loading, setLoading] = useState(false)

  const parse = async (description: string) => {
    setLoading(true)
    setErrorKey(null)
    try {
      const result = await client.parse({
        text: description,
        currency,
        locale,
        members: members.map(member => ({ id: member.id, name: member.name })),
      })
      if (result.status === 'needs_clarification') {
        setClarification(result.question)
        setAnswer('')
        return
      }
      onDraft(result)
    } catch (error) {
      setErrorKey(errorTranslationKey(error))
    } finally {
      setLoading(false)
    }
  }

  const submitDescription = () => parse(text.trim())
  const submitClarification = () => {
    const clarified = `${text.trim()}\nClarification question: ${clarification}\nUser answer: ${answer.trim()}`
    void parse(clarified.slice(0, AI_EXPENSE_TEXT_MAX_LENGTH))
  }

  return (
    <section className="ai-expense-composer" aria-labelledby="ai-expense-heading">
      <div className="ai-expense-intro">
        <span><Sparkles size={18} /></span>
        <div><b id="ai-expense-heading">{t('expense.aiTitle')}</b><p>{t('expense.aiHelp')}</p></div>
      </div>

      <label>
        {t('expense.aiPrompt')}
        <textarea
          autoFocus
          aria-label={t('expense.aiPrompt')}
          value={text}
          maxLength={AI_EXPENSE_TEXT_MAX_LENGTH}
          rows={4}
          placeholder={t('expense.aiPlaceholder')}
          onChange={event => {
            setText(event.target.value)
            setClarification(null)
            setAnswer('')
            setErrorKey(null)
          }}
        />
        <small>{t('expense.aiExample')}</small>
      </label>

      {clarification ? (
        <div className="ai-clarification" role="status">
          <span><b>{t('expense.aiClarification')}</b><p>{clarification}</p></span>
          <label>{t('expense.aiAnswer')}<input value={answer} onChange={event => setAnswer(event.target.value)} maxLength={200} /></label>
        </div>
      ) : null}

      {errorKey ? (
        <div className="ai-expense-error" role="alert">
          <b>{t(errorKey)}</b>
          <Button variant="ghost" onClick={() => setErrorKey(null)}>{t('expense.aiTryAgain')}</Button>
        </div>
      ) : null}

      <div className="split-note ai-privacy-note">
        <ShieldCheck size={18} />
        <span>{t('expense.aiPrivacy')}</span>
      </div>

      <div className="modal-actions">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {clarification ? (
          <Button variant="primary" onClick={submitClarification} disabled={loading || !answer.trim()}>
            {loading ? t('expense.aiWorking') : t('expense.aiContinue')}<ArrowRight size={16} />
          </Button>
        ) : (
          <Button variant="primary" onClick={submitDescription} disabled={loading || text.trim().length < 3}>
            {loading ? t('expense.aiWorking') : t('expense.aiGenerate')}<Sparkles size={16} />
          </Button>
        )}
      </div>
    </section>
  )
}
