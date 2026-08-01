import {
  AI_EXPENSE_AUDIO_MAX_BYTES,
  AI_EXPENSE_AUDIO_SAMPLE_RATE,
  type VoiceAiExpenseRequest,
} from './aiExpenseContract.ts'

export type ValidatedVoiceAudio = {
  bytes: Uint8Array
  durationSeconds: number
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function decodeBase64(value: string) {
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('The audio is not valid base64.')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function validateVoiceWav(
  audio: VoiceAiExpenseRequest['audio'],
): ValidatedVoiceAudio {
  const bytes = decodeBase64(audio.data)
  if (bytes.length < 44 || bytes.length > AI_EXPENSE_AUDIO_MAX_BYTES) {
    throw new Error('The audio size is outside the supported range.')
  }
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('The audio must be a WAV file.')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 12
  let format: { encoding: number; channels: number; sampleRate: number; byteRate: number; blockAlign: number; bits: number } | null = null
  let dataLength = 0
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(bytes, offset, 4)
    const chunkLength = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkEnd > bytes.length) throw new Error('The WAV file contains an invalid chunk.')
    if (chunkId === 'fmt ' && chunkLength >= 16) {
      format = {
        encoding: view.getUint16(chunkStart, true),
        channels: view.getUint16(chunkStart + 2, true),
        sampleRate: view.getUint32(chunkStart + 4, true),
        byteRate: view.getUint32(chunkStart + 8, true),
        blockAlign: view.getUint16(chunkStart + 12, true),
        bits: view.getUint16(chunkStart + 14, true),
      }
    }
    if (chunkId === 'data') dataLength = chunkLength
    offset = chunkEnd + (chunkLength % 2)
  }

  if (!format
    || format.encoding !== 1
    || format.channels !== 1
    || format.sampleRate !== AI_EXPENSE_AUDIO_SAMPLE_RATE
    || format.byteRate !== AI_EXPENSE_AUDIO_SAMPLE_RATE * 2
    || format.blockAlign !== 2
    || format.bits !== 16
    || dataLength < 2
    || dataLength % 2 !== 0) {
    throw new Error('The WAV file must be mono 16 kHz 16-bit PCM audio.')
  }
  const durationSeconds = dataLength / format.byteRate
  if (Math.abs(durationSeconds - audio.durationSeconds) > 1) {
    throw new Error('The audio duration does not match its metadata.')
  }
  return { bytes, durationSeconds }
}
