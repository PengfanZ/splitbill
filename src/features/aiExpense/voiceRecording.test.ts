import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AI_EXPENSE_AUDIO_MIN_SECONDS,
  VOICE_STREAM_START_TIMEOUT_MS,
  VoiceStreamStartTimeoutError,
  downmixAndResample,
  encodePcm16Wav,
  preferredRecorderMimeType,
  requestVoiceStream,
  recordedBlobToVoiceAudio,
} from './voiceRecording'

function audioBuffer({
  channels = [new Float32Array([0, 0.5, -0.5, 1])],
  sampleRate = 16_000,
  length = channels[0]?.length ?? 0,
}: {
  channels?: Float32Array[]
  sampleRate?: number
  length?: number
} = {}) {
  return {
    numberOfChannels: channels.length,
    length,
    sampleRate,
    getChannelData: (channel: number) => channels[channel],
  } as AudioBuffer
}

describe('voice recording conversion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('selects the first supported recorder format and handles missing support', () => {
    expect(preferredRecorderMimeType(type => type === 'audio/mp4')).toBe('audio/mp4')
    expect(preferredRecorderMimeType(() => false)).toBeNull()
    expect(preferredRecorderMimeType(undefined)).toBeNull()
  })

  it('requests a broadly compatible audio-only stream', async () => {
    const stream = { getTracks: vi.fn(() => []) } as unknown as MediaStream
    const getUserMedia = vi.fn().mockResolvedValue(stream)
    await expect(requestVoiceStream(getUserMedia)).resolves.toBe(stream)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
  })

  it('propagates permission rejection and bounds a request that never resolves', async () => {
    await expect(requestVoiceStream(
      vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
    )).rejects.toMatchObject({ name: 'NotAllowedError' })

    vi.useFakeTimers()
    const stop = vi.fn()
    let resolveStream!: (stream: MediaStream) => void
    const pending = requestVoiceStream(
      vi.fn(() => new Promise<MediaStream>(resolve => { resolveStream = resolve })),
    )
    const rejection = expect(pending).rejects.toBeInstanceOf(VoiceStreamStartTimeoutError)
    await vi.advanceTimersByTimeAsync(VOICE_STREAM_START_TIMEOUT_MS)
    await rejection
    resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await Promise.resolve()
    expect(stop).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('downmixes stereo audio and preserves a matching sample rate', () => {
    const result = downmixAndResample(audioBuffer({
      channels: [new Float32Array([1, 0]), new Float32Array([-1, 1])],
    }))
    expect([...result]).toEqual([0, 0.5])
  })

  it('resamples decoded audio using linear interpolation', () => {
    const result = downmixAndResample(audioBuffer({
      channels: [new Float32Array([0, 1, 0, -1])],
      sampleRate: 32_000,
    }))
    expect([...result]).toEqual([0, 0])
  })

  it.each([
    audioBuffer({ channels: [] }),
    audioBuffer({ length: 0 }),
    audioBuffer({ sampleRate: 0 }),
  ])('rejects decoded buffers without usable audio', buffer => {
    expect(() => downmixAndResample(buffer)).toThrow('did not contain audio')
  })

  it('encodes clipped PCM samples as a standard little-endian WAV', () => {
    const wav = encodePcm16Wav(new Float32Array([-2, -0.5, 0.5, 2]))
    const view = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(46, true)).toBe(-16384)
    expect(view.getInt16(48, true)).toBe(16383)
    expect(view.getInt16(50, true)).toBe(32767)
  })

  it('decodes, resamples, encodes, and closes the audio context', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const createContext = vi.fn(() => ({
      decodeAudioData: vi.fn().mockResolvedValue(audioBuffer({
        channels: [new Float32Array(16_000).fill(0.25)],
      })),
      close,
    }))
    const result = await recordedBlobToVoiceAudio(new Blob(['recording']), createContext)
    expect(result).toMatchObject({ format: 'wav', durationSeconds: 1 })
    expect(result.data.startsWith('UklGR')).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects empty, too-short, and too-long recordings while closing resources', async () => {
    await expect(recordedBlobToVoiceAudio(new Blob([]), vi.fn())).rejects.toThrow('did not contain audio')

    const shortClose = vi.fn().mockResolvedValue(undefined)
    await expect(recordedBlobToVoiceAudio(new Blob(['x']), () => ({
      decodeAudioData: vi.fn().mockResolvedValue(audioBuffer({
        channels: [new Float32Array(Math.floor(16_000 * (AI_EXPENSE_AUDIO_MIN_SECONDS / 2)))],
      })),
      close: shortClose,
    }))).rejects.toThrow('too short')
    expect(shortClose).toHaveBeenCalledOnce()

    const longClose = vi.fn().mockResolvedValue(undefined)
    await expect(recordedBlobToVoiceAudio(new Blob(['x']), () => ({
      decodeAudioData: vi.fn().mockResolvedValue(audioBuffer({
        channels: [new Float32Array(16_000 * 61)],
      })),
      close: longClose,
    }))).rejects.toThrow('too long')
    expect(longClose).toHaveBeenCalledOnce()
  })

  it('closes the context after decode failures and reports missing browser support', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    await expect(recordedBlobToVoiceAudio(new Blob(['x']), () => ({
      decodeAudioData: vi.fn().mockRejectedValue(new Error('decode failed')),
      close,
    }))).rejects.toThrow('decode failed')
    expect(close).toHaveBeenCalledOnce()

    vi.stubGlobal('AudioContext', undefined)
    await expect(recordedBlobToVoiceAudio(new Blob(['x']))).rejects.toThrow('not supported')
  })

  it('uses the browser AudioContext by default when it is available', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    class FakeAudioContext {
      decodeAudioData = vi.fn().mockResolvedValue(audioBuffer({
        channels: [new Float32Array(16_000)],
      }))
      close = close
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    await expect(recordedBlobToVoiceAudio(new Blob(['x']))).resolves.toMatchObject({
      format: 'wav',
      durationSeconds: 1,
    })
    expect(close).toHaveBeenCalledOnce()
  })
})
