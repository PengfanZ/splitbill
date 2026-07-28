import { compressToEncodedURIComponent } from 'lz-string'
import { describe, expect, it } from 'vitest'
import { decompressFromEncodedURIComponentBounded } from './boundedLzString'

describe('bounded LZ-string decoding', () => {
  it('preserves the LZ-string empty-value representation', () => {
    expect(
      decompressFromEncodedURIComponentBounded(
        compressToEncodedURIComponent(''),
        100,
      ),
    ).toBe('')
  })

  it.each([
    'plain ASCII',
    'Unicode 夏天 🏖️',
    'a'.repeat(10_000),
    `${String.fromCharCode(300)}${String.fromCharCode(301)}`.repeat(100),
  ])('round-trips supported LZ-string data without exceeding the bound', value => {
    expect(
      decompressFromEncodedURIComponentBounded(
        compressToEncodedURIComponent(value),
        value.length,
      ),
    ).toBe(value)
  })

  it('stops expansion as soon as the decoded output exceeds the limit', () => {
    const compressed = compressToEncodedURIComponent('a'.repeat(200_000))

    expect(decompressFromEncodedURIComponentBounded(compressed, 128 * 1024)).toBeNull()
  })

  it.each([
    ['', 100],
    ['%%%', 100],
    ['A%', 100],
    [compressToEncodedURIComponent('value').slice(0, 1), 100],
    [compressToEncodedURIComponent('value'), 0],
    [compressToEncodedURIComponent('value'), 1.5],
  ])('rejects malformed data or invalid limits', (compressed, limit) => {
    expect(decompressFromEncodedURIComponentBounded(compressed, limit)).toBeNull()
  })

  it('fails closed for truncated and corrupted URI-safe streams without exceeding the bound', () => {
    const validTokens = [
      compressToEncodedURIComponent('several different words and symbols 夏天'),
      compressToEncodedURIComponent('abcabcabcabcabcabcabcabcabcabc'),
    ]
    const candidates = validTokens.flatMap(token => (
      Array.from({ length: token.length - 1 }, (_, index) => token.slice(0, index + 1))
    ))
    let seed = 1
    for (let sample = 0; sample < 500; sample += 1) {
      let token = ''
      const length = 2 + (sample % 14)
      for (let index = 0; index < length; index += 1) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
        token += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$'.charAt(seed % 65)
      }
      candidates.push(token)
    }

    candidates.forEach(token => {
      const result = decompressFromEncodedURIComponentBounded(token, 64)
      expect(result === null || result.length <= 64).toBe(true)
    })
  })
})
