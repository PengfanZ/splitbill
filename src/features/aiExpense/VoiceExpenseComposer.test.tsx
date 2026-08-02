import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member } from '../../domain/models'
import { LocalizationProvider } from '../../i18n/LocalizationContext'
import { AiExpenseApiError, type AiExpenseClient } from './aiExpenseApi'
import type { VoiceAiExpenseRequest } from './aiExpenseContract'
import { VoiceExpenseComposer, voiceExpenseErrorKey } from './VoiceExpenseComposer'
import { VOICE_STREAM_START_TIMEOUT_MS } from './voiceRecording'

const recordingMocks = vi.hoisted(() => ({
  preferredRecorderMimeType: vi.fn((): string | null => 'audio/webm'),
  recordedBlobToVoiceAudio: vi.fn(),
}))

vi.mock('./voiceRecording', async importOriginal => ({
  ...(await importOriginal<typeof import('./voiceRecording')>()),
  preferredRecorderMimeType: recordingMocks.preferredRecorderMimeType,
  recordedBlobToVoiceAudio: recordingMocks.recordedBlobToVoiceAudio,
}))

const members: Member[] = [
  { id: 'me', name: 'Alex', initials: 'A', color: '#aaa' },
  { id: 'maya', name: 'Maya', initials: 'M', color: '#bbb' },
]
const audio = { data: 'A'.repeat(64), format: 'wav' as const, durationSeconds: 1 }
const draft = {
  status: 'ready' as const,
  title: 'Dinner',
  amountCents: 3000,
  payerId: 'maya',
  splitMethod: 'equal' as const,
  participantIds: ['me', 'maya'],
  exactSharesCents: [],
}
const batch = { status: 'ready_batch' as const, drafts: [draft] }

class FakeMediaRecorder {
  static emitEmptyChunk = false
  static failOnStop = false
  static suppressOnStop = false
  static ignoreMimeType = false
  state: RecordingState = 'inactive'
  mimeType: string
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = FakeMediaRecorder.ignoreMimeType ? '' : options?.mimeType ?? ''
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    if (FakeMediaRecorder.failOnStop) {
      this.onerror?.()
      return
    }
    this.ondataavailable?.({
      data: FakeMediaRecorder.emitEmptyChunk ? new Blob([]) : new Blob(['voice']),
    } as BlobEvent)
    if (FakeMediaRecorder.suppressOnStop) return
    this.onstop?.()
  }
}

function createStream() {
  const stop = vi.fn()
  return {
    stream: { getTracks: () => [{ stop }] } as unknown as MediaStream,
    stop,
  }
}

function renderComposer(client: Pick<AiExpenseClient, 'parseBatch'>, onDrafts = vi.fn(), onClose = vi.fn()) {
  return {
    onDrafts,
    onClose,
    ...render(
      <LocalizationProvider>
        <VoiceExpenseComposer
          client={client}
          currency="USD"
          members={members}
          viewerMemberId="me"
          onClose={onClose}
          onDrafts={onDrafts}
        />
      </LocalizationProvider>,
    ),
  }
}

async function recordOnce(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Start recording' }))
  await screen.findByText('Listening… tap to stop')
  await user.click(screen.getByRole('button', { name: 'Stop recording' }))
}

describe('voice expense composer', () => {
  beforeEach(() => {
    FakeMediaRecorder.emitEmptyChunk = false
    FakeMediaRecorder.failOnStop = false
    FakeMediaRecorder.suppressOnStop = false
    FakeMediaRecorder.ignoreMimeType = false
    recordingMocks.preferredRecorderMimeType.mockReturnValue('audio/webm')
    recordingMocks.recordedBlobToVoiceAudio.mockReset().mockResolvedValue(audio)
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const { stream } = createStream()
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('records voice, creates a reviewable draft, and stops the microphone', async () => {
    const user = userEvent.setup()
    const { stream, stop } = createStream()
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    const parseBatch = vi.fn().mockResolvedValue(batch)
    const { onDrafts } = renderComposer({ parseBatch })

    await recordOnce(user)
    await waitFor(() => expect(onDrafts).toHaveBeenCalledWith([draft]))
    expect(stop).toHaveBeenCalledOnce()
    expect(parseBatch).toHaveBeenCalledWith({
      inputMode: 'voice',
      audio,
      currency: 'USD',
      locale: 'en',
      members: [{ id: 'me', name: 'Alex' }, { id: 'maya', name: 'Maya' }],
      viewerMemberId: 'me',
    })
  })

  it('starts recording after Strict Mode replays the mount effect', async () => {
    const user = userEvent.setup()
    const { stream, stop } = createStream()
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })

    render(
      <StrictMode>
        <LocalizationProvider>
          <VoiceExpenseComposer
            client={{ parseBatch: vi.fn().mockResolvedValue(batch) }}
            currency="USD"
            members={members}
            viewerMemberId="me"
            onClose={vi.fn()}
            onDrafts={vi.fn()}
          />
        </LocalizationProvider>
      </StrictMode>,
    )

    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Stop recording' }))
    expect(stop).toHaveBeenCalledOnce()
  })

  it('keeps the recording context when a typed follow-up completes the draft', async () => {
    const user = userEvent.setup()
    const parseBatch = vi.fn()
      .mockResolvedValueOnce({ status: 'needs_clarification', question: 'Who paid?' })
      .mockResolvedValueOnce(batch)
    const { onDrafts } = renderComposer({ parseBatch })

    await recordOnce(user)
    expect(await screen.findByText('Who paid?')).toBeVisible()
    await user.type(screen.getByLabelText('Your answer'), 'Maya')
    await user.click(screen.getByRole('button', { name: /Update draft/ }))

    await waitFor(() => expect(onDrafts).toHaveBeenCalledWith([draft]))
    expect(parseBatch).toHaveBeenLastCalledWith(expect.objectContaining({
      inputMode: 'voice',
      audio,
      clarifications: [{ question: 'Who paid?', answer: 'Maya' }],
    }))
  })

  it('handles unsupported browsers and denied microphone permission', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('MediaRecorder', undefined)
    renderComposer({ parseBatch: vi.fn() })
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(await screen.findByText(/not supported in this browser/)).toBeVisible()

    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    renderComposer({ parseBatch: vi.fn() })
    const buttons = screen.getAllByRole('button', { name: 'Start recording' })
    await user.click(buttons.at(-1)!)
    expect(await screen.findByText(/Microphone access was not granted/)).toBeVisible()
  })

  it('recovers when the browser leaves microphone permission pending', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>(() => undefined)) },
    })
    renderComposer({ parseBatch: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VOICE_STREAM_START_TIMEOUT_MS)
    })
    expect(screen.getByText(/selected microphone did not start/)).toBeVisible()
  })

  it('lets the user cancel a pending permission request and discards a late stream', async () => {
    const user = userEvent.setup()
    let resolveStream!: (stream: MediaStream) => void
    const lateStream = createStream()
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>(resolve => { resolveStream = resolve })) },
    })
    renderComposer({ parseBatch: vi.fn() })

    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(screen.getByText('Starting microphone…')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Starting microphone…' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel microphone request' }))

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => resolveStream(lateStream.stream))
    expect(lateStream.stop).toHaveBeenCalledOnce()
  })

  it('ignores a permission rejection after the user cancels the request', async () => {
    const user = userEvent.setup()
    let rejectStream!: (error: Error) => void
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>((_resolve, reject) => { rejectStream = reject })) },
    })
    renderComposer({ parseBatch: vi.fn() })

    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    await user.click(screen.getByRole('button', { name: 'Cancel microphone request' }))
    await act(async () => rejectStream(new Error('late permission rejection')))

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports unusable recordings and recorder failures without calling AI', async () => {
    const user = userEvent.setup()
    const parseBatch = vi.fn()
    recordingMocks.recordedBlobToVoiceAudio.mockRejectedValueOnce(new Error('empty'))
    renderComposer({ parseBatch })
    await recordOnce(user)
    expect(await screen.findByText(/could not hear enough/)).toBeVisible()
    expect(parseBatch).not.toHaveBeenCalled()

    FakeMediaRecorder.failOnStop = true
    renderComposer({ parseBatch })
    const startButtons = screen.getAllByRole('button', { name: 'Start recording' })
    await user.click(startButtons.at(-1)!)
    const stopButtons = screen.getAllByRole('button', { name: 'Stop recording' })
    await user.click(stopButtons.at(-1)!)
    expect(await screen.findByText(/Voice entry is temporarily unavailable/)).toBeVisible()
  })

  it('ignores empty recorder chunks and supports a recorder without an explicit MIME type', async () => {
    const user = userEvent.setup()
    FakeMediaRecorder.emitEmptyChunk = true
    recordingMocks.preferredRecorderMimeType.mockReturnValue(null)
    renderComposer({ parseBatch: vi.fn() })
    await recordOnce(user)
    expect(recordingMocks.recordedBlobToVoiceAudio).toHaveBeenCalledWith(expect.objectContaining({
      type: 'audio/webm',
    }))

    FakeMediaRecorder.emitEmptyChunk = false
    FakeMediaRecorder.ignoreMimeType = true
    recordingMocks.preferredRecorderMimeType.mockReturnValue('audio/webm')
    renderComposer({ parseBatch: vi.fn().mockResolvedValue(batch) })
    const startButtons = screen.getAllByRole('button', { name: 'Start recording' })
    await user.click(startButtons.at(-1)!)
    const stopButtons = screen.getAllByRole('button', { name: 'Stop recording' })
    await user.click(stopButtons.at(-1)!)
    expect(recordingMocks.recordedBlobToVoiceAudio).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'audio/webm',
    }))
  })

  it('does not stop an already-inactive recorder twice', async () => {
    const user = userEvent.setup()
    FakeMediaRecorder.suppressOnStop = true
    renderComposer({ parseBatch: vi.fn() })
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    const stop = screen.getByRole('button', { name: 'Stop recording' })
    await user.click(stop)
    await user.click(stop)
    expect(recordingMocks.recordedBlobToVoiceAudio).not.toHaveBeenCalled()
  })

  it('cleans up recording resources when closed and after a late permission response', async () => {
    const user = userEvent.setup()
    const { stream, stop } = createStream()
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    })
    const rendered = renderComposer({ parseBatch: vi.fn() })
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    rendered.unmount()
    expect(stop).toHaveBeenCalled()

    FakeMediaRecorder.failOnStop = true
    const failing = renderComposer({ parseBatch: vi.fn() })
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    failing.unmount()
    FakeMediaRecorder.failOnStop = false

    let resolveStream!: (stream: MediaStream) => void
    const lateStream = createStream()
    vi.stubGlobal('navigator', {
      languages: ['en-US'],
      language: 'en-US',
      mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>(resolve => { resolveStream = resolve })) },
    })
    const pending = renderComposer({ parseBatch: vi.fn() })
    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    pending.unmount()
    await act(async () => resolveStream(lateStream.stream))
    expect(lateStream.stop).toHaveBeenCalledOnce()
  })

  it('does not update state when audio processing finishes after unmount', async () => {
    const user = userEvent.setup()
    let resolveAudio!: (value: VoiceAiExpenseRequest['audio']) => void
    recordingMocks.recordedBlobToVoiceAudio.mockReturnValueOnce(new Promise(resolve => { resolveAudio = resolve }))
    const completed = renderComposer({ parseBatch: vi.fn() })
    await recordOnce(user)
    completed.unmount()
    await act(async () => resolveAudio(audio))

    let rejectAudio!: (error: Error) => void
    recordingMocks.recordedBlobToVoiceAudio.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectAudio = reject }))
    const failed = renderComposer({ parseBatch: vi.fn() })
    await recordOnce(user)
    failed.unmount()
    await act(async () => rejectAudio(new Error('late failure')))
  })

  it('does not update state when the AI request finishes after unmount', async () => {
    const user = userEvent.setup()
    let resolveDraft!: (value: typeof batch) => void
    const resolvedParse = vi.fn(() => new Promise<typeof batch>(resolve => { resolveDraft = resolve }))
    const resolved = renderComposer({ parseBatch: resolvedParse })
    await recordOnce(user)
    await waitFor(() => expect(resolvedParse).toHaveBeenCalled())
    resolved.unmount()
    await act(async () => resolveDraft(batch))

    let rejectDraft!: (error: Error) => void
    const rejectedParse = vi.fn(() => new Promise<typeof batch>((_resolve, reject) => { rejectDraft = reject }))
    const rejected = renderComposer({ parseBatch: rejectedParse })
    await recordOnce(user)
    await waitFor(() => expect(rejectedParse).toHaveBeenCalled())
    rejected.unmount()
    await act(async () => rejectDraft(new Error('late provider failure')))
  })

  it('automatically stops a recording at sixty seconds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00Z'))
    const parseBatch = vi.fn().mockResolvedValue(batch)
    renderComposer({ parseBatch })
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    await act(async () => { await Promise.resolve() })
    await act(async () => {
      vi.setSystemTime(new Date('2026-08-01T12:00:01Z'))
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(screen.getByText('0:01 / 1:00')).toBeVisible()
    await act(async () => {
      vi.setSystemTime(new Date('2026-08-01T12:01:00Z'))
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(parseBatch).toHaveBeenCalled()
  })

  it('maps API failures to specific safe messages', () => {
    expect(voiceExpenseErrorKey(new Error('unknown'))).toBe('expense.voiceError')
    expect(voiceExpenseErrorKey(new AiExpenseApiError('rate-limit', 'x'))).toBe('expense.voiceRateLimit')
    expect(voiceExpenseErrorKey(new AiExpenseApiError('model-unavailable', 'x'))).toBe('expense.voiceModelUnavailable')
    expect(voiceExpenseErrorKey(new AiExpenseApiError('credits', 'x'))).toBe('expense.voiceCredits')
    expect(voiceExpenseErrorKey(new AiExpenseApiError('invalid-input', 'x'))).toBe('expense.voiceInvalid')
    expect(voiceExpenseErrorKey(new AiExpenseApiError('invalid-response', 'x'))).toBe('expense.voiceInvalid')
    expect(voiceExpenseErrorKey(new AiExpenseApiError('network', 'x'))).toBe('expense.voiceNetwork')
    expect(voiceExpenseErrorKey(new AiExpenseApiError('configuration', 'x'))).toBe('expense.voiceError')
  })

  it('shows rate-limit errors and allows dismissing them or cancelling', async () => {
    const user = userEvent.setup()
    const { onClose } = renderComposer({
      parseBatch: vi.fn().mockRejectedValue(new AiExpenseApiError('rate-limit', 'limited')),
    })
    await recordOnce(user)
    expect(await screen.findByText(/reached the voice-entry limit/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/reached the voice-entry limit/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
