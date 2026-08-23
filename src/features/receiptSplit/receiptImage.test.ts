import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_RECEIPT_IMAGE_BYTES,
  MAX_RECEIPT_UPLOAD_BYTES,
} from './receiptContract'
import { prepareReceiptImage, validateReceiptFile } from './receiptImage'

function file(name = 'receipt.jpg', type = 'image/jpeg', size = 1) {
  return new File([new Uint8Array(size)], name, { type })
}

function decoded(width = 100, height = 200) {
  return { width, height, close: vi.fn() } as unknown as CanvasImageSource & {
    width: number
    height: number
    close: () => void
  }
}

function canvas(blob = new Blob(['jpeg'], { type: 'image/jpeg' }), hasContext = true) {
  const context = hasContext ? { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() } : null
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(blob)),
    context,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('receipt image preparation', () => {
  it('validates supported files by MIME type or extension', () => {
    expect(() => validateReceiptFile(file())).not.toThrow()
    expect(() => validateReceiptFile(file('receipt.HEIC', 'application/octet-stream'))).not.toThrow()
    expect(() => validateReceiptFile(file('receipt.gif', 'image/gif'))).toThrow('JPG, PNG, WebP, or HEIC')
    expect(() => validateReceiptFile(file('empty.jpg', 'image/jpeg', 0))).toThrow('not empty')
    expect(() => validateReceiptFile(file('huge.jpg', 'image/jpeg', MAX_RECEIPT_IMAGE_BYTES + 1))).toThrow('5 MB')
  })

  it('normalizes, scales, paints a white background, and closes the decoded image', async () => {
    const image = decoded(4_000, 2_000)
    const target = canvas()
    const result = await prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(image),
      createCanvas: () => target as unknown as HTMLCanvasElement,
      readBlob: vi.fn().mockResolvedValue('data:image/jpeg;base64,QQ=='),
    })
    expect(result).toEqual({ dataUrl: 'data:image/jpeg;base64,QQ==', width: 2_048, height: 1_024 })
    expect(target.context?.fillRect).toHaveBeenCalledWith(0, 0, 2_048, 1_024)
    expect(target.context?.drawImage).toHaveBeenCalledWith(image, 0, 0, 2_048, 1_024)
    expect(image.close).toHaveBeenCalled()
  })

  it('uses browser image decoding and FileReader defaults', async () => {
    const image = decoded(10, 20)
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(image))
    const target = canvas(new Blob(['ok'], { type: 'image/jpeg' }))
    vi.spyOn(document, 'createElement').mockReturnValue(target as unknown as HTMLCanvasElement)
    const result = await prepareReceiptImage(file())
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(result).toMatchObject({ width: 10, height: 20 })
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: 'from-image' })
  })

  it('falls back to an object URL image decoder', async () => {
    Reflect.deleteProperty(globalThis, 'createImageBitmap')
    const revoke = vi.fn()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:receipt')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
    class MockImage {
      width = 4
      height = 5
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal('Image', MockImage)
    const target = canvas()
    const result = await prepareReceiptImage(file(), {
      createCanvas: () => target as unknown as HTMLCanvasElement,
      readBlob: vi.fn().mockResolvedValue('data:image/jpeg;base64,QQ=='),
    })
    expect(result).toMatchObject({ width: 4, height: 5 })
    expect(revoke).toHaveBeenCalledWith('blob:receipt')
  })

  it('reports decoding, dimension, canvas, compression, and encoding failures', async () => {
    await expect(prepareReceiptImage(file(), { decode: vi.fn().mockRejectedValue(new Error('decode')) })).rejects.toThrow('For HEIC images')

    const invalid = decoded(0, 5)
    await expect(prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(invalid),
      createCanvas: () => canvas() as unknown as HTMLCanvasElement,
    })).rejects.toThrow('invalid dimensions')
    expect(invalid.close).toHaveBeenCalled()

    await expect(prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(decoded(10_000, 10_000)),
      createCanvas: () => canvas() as unknown as HTMLCanvasElement,
    })).rejects.toThrow('resolution is too large')

    await expect(prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(decoded()),
      createCanvas: () => canvas(new Blob(), false) as unknown as HTMLCanvasElement,
    })).rejects.toThrow('could not prepare')

    const noBlob = canvas()
    noBlob.toBlob.mockImplementation(callback => callback(null))
    await expect(prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(decoded()),
      createCanvas: () => noBlob as unknown as HTMLCanvasElement,
    })).rejects.toThrow('could not be compressed')

    await expect(prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(decoded()),
      createCanvas: () => canvas(new Blob([new Uint8Array(MAX_RECEIPT_UPLOAD_BYTES + 1)])) as unknown as HTMLCanvasElement,
    })).rejects.toThrow('compressed receipt photo is still too large')

    await expect(prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(decoded()),
      createCanvas: () => canvas() as unknown as HTMLCanvasElement,
      readBlob: vi.fn().mockRejectedValue(new Error('encode')),
    })).rejects.toThrow('encode')
  })

  it('reports fallback image and FileReader failures', async () => {
    Reflect.deleteProperty(globalThis, 'createImageBitmap')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:receipt')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    class BrokenImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onerror?.()) }
    }
    vi.stubGlobal('Image', BrokenImage)
    await expect(prepareReceiptImage(file())).rejects.toThrow('For HEIC images')

    const readerSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function triggerError(this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
    })
    await expect(prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(decoded()),
      createCanvas: () => canvas() as unknown as HTMLCanvasElement,
    })).rejects.toThrow('could not be encoded')
    expect(readerSpy).toHaveBeenCalled()

    readerSpy.mockRestore()
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function triggerLoad(this: FileReader) {
      Object.defineProperty(this, 'result', { configurable: true, value: new ArrayBuffer(1) })
      this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>)
    })
    await expect(prepareReceiptImage(file(), {
      decode: vi.fn().mockResolvedValue(decoded()),
      createCanvas: () => canvas() as unknown as HTMLCanvasElement,
    })).rejects.toThrow('could not be encoded')
  })
})
