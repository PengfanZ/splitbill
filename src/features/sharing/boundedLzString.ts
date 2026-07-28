const URI_SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$'
const URI_SAFE_VALUES = new Map(
  Array.from(URI_SAFE_ALPHABET, (character, index) => [character, index]),
)

type BitReader = {
  input: string
  value: number
  position: number
  index: number
}

function readBits(reader: BitReader, bitCount: number) {
  let bits = 0
  for (let power = 1, index = 0; index < bitCount; power <<= 1, index += 1) {
    const bit = reader.value & reader.position
    reader.position >>= 1
    if (reader.position === 0) {
      if (reader.index >= reader.input.length) return null
      reader.position = 32
      reader.value = URI_SAFE_VALUES.get(reader.input.charAt(reader.index)) ?? -1
      reader.index += 1
      if (reader.value < 0) return null
    }
    if (bit > 0) bits |= power
  }
  return bits
}

function readCharacter(reader: BitReader, bitCount: 8 | 16) {
  const value = readBits(reader, bitCount)
  return value == null ? null : String.fromCharCode(value)
}

export function decompressFromEncodedURIComponentBounded(
  compressed: string,
  maxOutputLength: number,
) {
  if (!compressed || !Number.isSafeInteger(maxOutputLength) || maxOutputLength < 1) return null
  const input = compressed.replaceAll(' ', '+')
  const firstValue = URI_SAFE_VALUES.get(input.charAt(0))
  if (firstValue == null) return null

  const reader: BitReader = {
    input,
    value: firstValue,
    position: 32,
    index: 1,
  }
  const dictionary: Array<string | number | undefined> = [0, 1, 2]
  let enlargeIn = 4
  let dictionarySize = 4
  let bitCount = 3

  // The first URI-safe character always contains the two-bit stream prefix.
  const firstCode = readBits(reader, 2)!
  if (firstCode === 2) return ''
  const firstCharacter = readCharacter(reader, firstCode === 0 ? 8 : 16)
  if (firstCharacter == null) return null

  dictionary[3] = firstCharacter
  let previous = firstCharacter
  const result = [firstCharacter]
  let outputLength = firstCharacter.length

  while (true) {
    const nextCode = readBits(reader, bitCount)
    if (nextCode == null) return null
    if (nextCode === 2) return result.join('')

    let dictionaryCode = nextCode
    if (nextCode === 0 || nextCode === 1) {
      const character = readCharacter(reader, nextCode === 0 ? 8 : 16)
      if (character == null) return null
      dictionary[dictionarySize] = character
      dictionaryCode = dictionarySize
      dictionarySize += 1
      enlargeIn -= 1
    }

    if (enlargeIn === 0) {
      enlargeIn = 2 ** bitCount
      bitCount += 1
    }

    const knownEntry = dictionary[dictionaryCode]
    const entry = typeof knownEntry === 'string'
      ? knownEntry
      : dictionaryCode === dictionarySize
        ? previous + previous.charAt(0)
        : null
    if (entry == null) return null

    outputLength += entry.length
    if (outputLength > maxOutputLength) return null
    result.push(entry)

    dictionary[dictionarySize] = previous + entry.charAt(0)
    dictionarySize += 1
    enlargeIn -= 1
    previous = entry

    if (enlargeIn === 0) {
      enlargeIn = 2 ** bitCount
      bitCount += 1
    }
  }
}
