import {
  AI_EXPENSE_AUDIO_MAX_SECONDS,
  AI_EXPENSE_AUDIO_SAMPLE_RATE,
  type VoiceAiExpenseRequest,
} from './aiExpenseContract'

export const AI_EXPENSE_AUDIO_MIN_SECONDS = 0.25
export const VOICE_STREAM_START_TIMEOUT_MS = 15_000

export class VoiceStreamStartTimeoutError extends Error {
  constructor() {
    super('The microphone stream did not start in time.')
    this.name = 'VoiceStreamStartTimeoutError'
  }
}

const RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
] as const

type AudioContextLike = {
  decodeAudioData: (audioData: ArrayBuffer) => Promise<AudioBuffer>
  close: () => Promise<void>
}

export type AudioContextFactory = () => AudioContextLike

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>

export async function requestVoiceStream(
  getUserMedia: GetUserMedia,
  timeoutMs = VOICE_STREAM_START_TIMEOUT_MS,
) {
  let timedOut = false
  let timeoutId!: ReturnType<typeof setTimeout>
  const streamPromise = getUserMedia({ audio: true }).then(stream => {
    if (timedOut) stream.getTracks().forEach(track => track.stop())
    return stream
  })
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      reject(new VoiceStreamStartTimeoutError())
    }, timeoutMs)
  })
  try {
    return await Promise.race([streamPromise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId)
  }
}

export function preferredRecorderMimeType(
  isTypeSupported: ((mimeType: string) => boolean) | undefined = globalThis.MediaRecorder?.isTypeSupported,
) {
  if (!isTypeSupported) return null
  return RECORDER_MIME_TYPES.find(mimeType => isTypeSupported.call(globalThis.MediaRecorder, mimeType)) ?? null
}

function createBrowserAudioContext(): AudioContextLike {
  const AudioContextConstructor = globalThis.AudioContext
  if (!AudioContextConstructor) throw new Error('Audio processing is not supported in this browser.')
  return new AudioContextConstructor()
}

export function downmixAndResample(buffer: AudioBuffer, targetSampleRate = AI_EXPENSE_AUDIO_SAMPLE_RATE) {
  if (buffer.numberOfChannels < 1 || buffer.length < 1 || buffer.sampleRate < 1) {
    throw new Error('The recording did not contain audio.')
  }
  const mono = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const samples = buffer.getChannelData(channel)
    for (let index = 0; index < buffer.length; index += 1) mono[index] += samples[index] / buffer.numberOfChannels
  }
  if (buffer.sampleRate === targetSampleRate) return mono

  const outputLength = Math.max(1, Math.round(mono.length * targetSampleRate / buffer.sampleRate))
  const output = new Float32Array(outputLength)
  const ratio = buffer.sampleRate / targetSampleRate
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio
    const left = Math.min(Math.floor(position), mono.length - 1)
    const right = Math.min(left + 1, mono.length - 1)
    const fraction = position - left
    output[index] = mono[left] + (mono[right] - mono[left]) * fraction
  }
  return output
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = AI_EXPENSE_AUDIO_SAMPLE_RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index)
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function recordedBlobToVoiceAudio(
  blob: Blob,
  createAudioContext: AudioContextFactory = createBrowserAudioContext,
): Promise<VoiceAiExpenseRequest['audio']> {
  if (blob.size < 1) throw new Error('The recording did not contain audio.')
  const context = createAudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const samples = downmixAndResample(decoded)
    const durationSeconds = samples.length / AI_EXPENSE_AUDIO_SAMPLE_RATE
    if (durationSeconds < AI_EXPENSE_AUDIO_MIN_SECONDS) throw new Error('The recording is too short.')
    if (durationSeconds > AI_EXPENSE_AUDIO_MAX_SECONDS) throw new Error('The recording is too long.')
    return {
      data: bytesToBase64(encodePcm16Wav(samples)),
      format: 'wav',
      durationSeconds,
    }
  } finally {
    await context.close()
  }
}
