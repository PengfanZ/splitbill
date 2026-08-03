import { describe, expect, it } from 'vitest'
import { encodePcm16Wav } from './voiceRecording'
import { validateVoiceWav } from './voiceAudio'

function base64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function audio(bytes: Uint8Array, durationSeconds = (bytes.length - 44) / 32_000) {
  return { data: base64(bytes), format: 'wav' as const, durationSeconds }
}

function mutate(bytes: Uint8Array, action: (view: DataView, bytes: Uint8Array) => void) {
  const copy = bytes.slice()
  action(new DataView(copy.buffer), copy)
  return copy
}

describe('server voice WAV validation', () => {
  const valid = encodePcm16Wav(new Float32Array(16_000).fill(0.1))

  it('accepts standard mono 16 kHz PCM audio', () => {
    expect(validateVoiceWav(audio(valid))).toMatchObject({ durationSeconds: 1 })
  })

  it('rejects invalid base64, undersized audio, and non-WAV containers', () => {
    expect(() => validateVoiceWav({ data: '%'.repeat(64), format: 'wav', durationSeconds: 1 })).toThrow('base64')
    expect(() => validateVoiceWav(audio(new Uint8Array(20), 1))).toThrow('size')
    expect(() => validateVoiceWav(audio(mutate(valid, (_view, bytes) => { bytes[0] = 0 }), 1))).toThrow('WAV')
    expect(() => validateVoiceWav(audio(mutate(valid, (_view, bytes) => { bytes[8] = 0 }), 1))).toThrow('WAV')
  })

  it.each([
    ['encoding', 20, 3, 2],
    ['channels', 22, 2, 2],
    ['sample rate', 24, 44_100, 4],
    ['byte rate', 28, 1, 4],
    ['block alignment', 32, 1, 2],
    ['bits per sample', 34, 8, 2],
  ])('rejects an invalid %s field', (_label, offset, value, size) => {
    const changed = mutate(valid, view => {
      if (size === 2) view.setUint16(offset, value, true)
      else view.setUint32(offset, value, true)
    })
    expect(() => validateVoiceWav(audio(changed, 1))).toThrow('mono 16 kHz')
  })

  it('rejects empty and odd-length PCM data', () => {
    const empty = valid.slice(0, 44)
    new DataView(empty.buffer).setUint32(40, 0, true)
    expect(() => validateVoiceWav(audio(empty, 1))).toThrow('mono 16 kHz')

    const odd = valid.slice(0, 46)
    new DataView(odd.buffer).setUint32(40, 1, true)
    expect(() => validateVoiceWav(audio(odd, 1))).toThrow('mono 16 kHz')
  })

  it('rejects chunks that extend beyond the file and missing format or data chunks', () => {
    const oversizedChunk = mutate(valid, view => view.setUint32(16, valid.length, true))
    expect(() => validateVoiceWav(audio(oversizedChunk, 1))).toThrow('invalid chunk')

    const missingFormat = mutate(valid, (_view, bytes) => { bytes[12] = 0 })
    expect(() => validateVoiceWav(audio(missingFormat, 1))).toThrow('mono 16 kHz')

    const missingData = mutate(valid, (_view, bytes) => { bytes[36] = 0 })
    expect(() => validateVoiceWav(audio(missingData, 1))).toThrow('mono 16 kHz')
  })

  it('rejects duration metadata mismatches and audio over 60 seconds', () => {
    expect(() => validateVoiceWav(audio(valid, 3))).toThrow('does not match')
    const tooLong = encodePcm16Wav(new Float32Array(16_000 * 61))
    expect(() => validateVoiceWav(audio(tooLong, 60))).toThrow('size')
  })

  it('skips unknown padded WAV chunks', () => {
    const withJunk = new Uint8Array(valid.length + 10)
    withJunk.set(valid.subarray(0, 12), 0)
    withJunk.set(new TextEncoder().encode('JUNK'), 12)
    new DataView(withJunk.buffer).setUint32(16, 1, true)
    withJunk[20] = 42
    withJunk.set(valid.subarray(12), 22)
    new DataView(withJunk.buffer).setUint32(4, withJunk.length - 8, true)
    expect(validateVoiceWav(audio(withJunk, 1))).toMatchObject({ durationSeconds: 1 })
  })
})
