import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Mic, ShieldCheck, Square } from 'lucide-react'
import { Button } from '../../components/Button'
import type { CurrencyCode } from '../../domain/currency'
import type { Member } from '../../domain/models'
import { useLocalization } from '../../i18n/LocalizationContext'
import { AiExpenseApiError, type AiExpenseClient } from './aiExpenseApi'
import {
  AI_EXPENSE_ANSWER_MAX_LENGTH,
  AI_EXPENSE_AUDIO_MAX_SECONDS,
  type AiExpenseClarification,
  type AiExpenseReadyDraft,
  type VoiceAiExpenseRequest,
} from './aiExpenseContract'
import {
  preferredRecorderMimeType,
  recordedBlobToVoiceAudio,
  requestVoiceStream,
  VoiceStreamStartTimeoutError,
} from './voiceRecording'

type VoiceState = 'idle' | 'requesting' | 'recording' | 'processing' | 'clarification'
type VoiceErrorKey =
  | 'expense.voiceError'
  | 'expense.voiceRateLimit'
  | 'expense.voiceModelUnavailable'
  | 'expense.voiceCredits'
  | 'expense.voiceNetwork'
  | 'expense.voiceInvalid'
  | 'expense.voiceEmpty'
  | 'expense.voiceUnsupported'
  | 'expense.voicePermission'
  | 'expense.voiceStartTimeout'

export function voiceExpenseErrorKey(error: unknown): VoiceErrorKey {
  if (!(error instanceof AiExpenseApiError)) return 'expense.voiceError'
  if (error.kind === 'rate-limit') return 'expense.voiceRateLimit'
  if (error.kind === 'model-unavailable') return 'expense.voiceModelUnavailable'
  if (error.kind === 'credits') return 'expense.voiceCredits'
  if (error.kind === 'network') return 'expense.voiceNetwork'
  if (error.kind === 'invalid-input' || error.kind === 'invalid-response') return 'expense.voiceInvalid'
  return 'expense.voiceError'
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach(track => track.stop())
}

export function VoiceExpenseComposer({
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
  const [state, setState] = useState<VoiceState>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [clarification, setClarification] = useState<string | null>(null)
  const [clarificationHistory, setClarificationHistory] = useState<AiExpenseClarification[]>([])
  const [answer, setAnswer] = useState('')
  const [errorKey, setErrorKey] = useState<VoiceErrorKey | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const audioRef = useRef<VoiceAiExpenseRequest['audio'] | null>(null)
  const mountedRef = useRef(true)
  const requestAttemptRef = useRef(0)

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestAttemptRef.current += 1
      clearTimer()
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      stopTracks(streamRef.current)
    }
  }, [])

  const parse = async (
    audio: VoiceAiExpenseRequest['audio'],
    history: AiExpenseClarification[] = clarificationHistory,
  ) => {
    setState('processing')
    setErrorKey(null)
    try {
      const result = await client.parse({
        inputMode: 'voice',
        audio,
        currency,
        locale,
        members: members.map(member => ({ id: member.id, name: member.name })),
        ...(history.length > 0 ? { clarifications: history } : {}),
      })
      if (!mountedRef.current) return
      if (result.status === 'needs_clarification') {
        setClarificationHistory(history)
        setClarification(result.question)
        setAnswer('')
        setState('clarification')
        return
      }
      onDraft(result)
    } catch (error) {
      if (!mountedRef.current) return
      setErrorKey(voiceExpenseErrorKey(error))
      setState('idle')
    }
  }

  const processRecording = async (chunks: Blob[], mimeType: string) => {
    setState('processing')
    try {
      const audio = await recordedBlobToVoiceAudio(new Blob(chunks, { type: mimeType }))
      if (!mountedRef.current) return
      audioRef.current = audio
      setClarification(null)
      setClarificationHistory([])
      await parse(audio, [])
    } catch {
      if (!mountedRef.current) return
      setErrorKey('expense.voiceEmpty')
      setState('idle')
    }
  }

  const stopRecording = () => {
    clearTimer()
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const startRecording = async () => {
    const requestAttempt = requestAttemptRef.current + 1
    requestAttemptRef.current = requestAttempt
    setErrorKey(null)
    setState('requesting')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorKey('expense.voiceUnsupported')
      setState('idle')
      return
    }
    try {
      const stream = await requestVoiceStream(
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
      )
      if (!mountedRef.current || requestAttempt !== requestAttemptRef.current) {
        stopTracks(stream)
        return
      }
      streamRef.current = stream
      const mimeType = preferredRecorderMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stopTracks(streamRef.current)
        streamRef.current = null
        recorderRef.current = null
        if (!mountedRef.current) return
        void processRecording(chunks, recorder.mimeType || mimeType || 'audio/webm')
      }
      recorder.onerror = () => {
        clearTimer()
        stopTracks(streamRef.current)
        streamRef.current = null
        recorderRef.current = null
        if (!mountedRef.current) return
        setErrorKey('expense.voiceError')
        setState('idle')
      }
      startedAtRef.current = Date.now()
      setElapsedSeconds(0)
      recorder.start()
      setState('recording')
      timerRef.current = setInterval(() => {
        const elapsed = Math.min(AI_EXPENSE_AUDIO_MAX_SECONDS, Math.floor((Date.now() - startedAtRef.current) / 1000))
        setElapsedSeconds(elapsed)
        if (elapsed >= AI_EXPENSE_AUDIO_MAX_SECONDS) stopRecording()
      }, 250)
    } catch (error) {
      if (!mountedRef.current || requestAttempt !== requestAttemptRef.current) return
      stopTracks(streamRef.current)
      streamRef.current = null
      setErrorKey(error instanceof VoiceStreamStartTimeoutError
        ? 'expense.voiceStartTimeout'
        : 'expense.voicePermission')
      setState('idle')
    }
  }

  const cancelMicrophoneRequest = () => {
    requestAttemptRef.current += 1
    setState('idle')
    setErrorKey(null)
  }

  const submitClarification = () => {
    void parse(audioRef.current!, [...clarificationHistory, { question: clarification!, answer: answer.trim() }])
  }

  const busy = state === 'processing'
  const timer = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`

  return (
    <section className="ai-expense-composer voice-expense-composer" aria-labelledby="voice-expense-heading">
      <div className="ai-expense-intro">
        <span><Mic size={18} /></span>
        <div><b id="voice-expense-heading">{t('expense.voiceTitle')}</b><p>{t('expense.voiceHelp')}</p></div>
      </div>

      <div className="voice-recorder" aria-live="polite">
        <button
          type="button"
          className={`voice-record-button${state === 'recording' ? ' recording' : state === 'requesting' ? ' requesting' : ''}`}
          aria-label={t(state === 'recording'
            ? 'expense.voiceStop'
            : state === 'requesting'
              ? 'expense.voiceRequesting'
              : 'expense.voiceStart')}
          disabled={busy || state === 'clarification' || state === 'requesting'}
          onClick={state === 'recording'
            ? stopRecording
            : () => void startRecording()}
        >
          {state === 'recording'
            ? <Square size={30} fill="currentColor" />
            : <Mic size={34} />}
        </button>
        <b>{t(state === 'recording' ? 'expense.voiceListening' : state === 'processing' ? 'expense.voiceProcessing' : state === 'requesting' ? 'expense.voiceRequesting' : 'expense.voiceStart')}</b>
        <small>{state === 'recording' ? `${timer} / 1:00` : t('expense.voiceLimit')}</small>
        {state === 'requesting' ? (
          <button type="button" className="voice-request-cancel" onClick={cancelMicrophoneRequest}>
            {t('expense.voiceCancelRequest')}
          </button>
        ) : null}
      </div>

      {clarification && state === 'clarification' ? (
        <div className="ai-clarification" role="status">
          <span><b>{t('expense.aiClarification')}</b><p>{clarification}</p></span>
          <label>{t('expense.aiAnswer')}<input autoFocus value={answer} onChange={event => setAnswer(event.target.value)} maxLength={AI_EXPENSE_ANSWER_MAX_LENGTH} /></label>
          <small>{t('expense.voiceClarificationHelp')}</small>
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
        <span>{t('expense.voicePrivacy')}</span>
      </div>

      <div className="modal-actions">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {clarification && state === 'clarification' ? (
          <Button variant="primary" onClick={submitClarification} disabled={!answer.trim()}>
            {t('expense.aiContinue')}<ArrowRight size={16} />
          </Button>
        ) : null}
      </div>
    </section>
  )
}
