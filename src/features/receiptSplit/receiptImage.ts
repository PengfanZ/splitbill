import {
  MAX_RECEIPT_IMAGE_BYTES,
  MAX_RECEIPT_IMAGE_PIXELS,
  MAX_RECEIPT_LONG_EDGE,
  MAX_RECEIPT_UPLOAD_BYTES,
} from './receiptContract'

export type PreparedReceiptImage = {
  dataUrl: string
  width: number
  height: number
}

type DecodedImage = CanvasImageSource & {
  width: number
  height: number
  close?: () => void
}

type ReceiptImageDependencies = {
  decode: (file: File) => Promise<DecodedImage>
  createCanvas: () => HTMLCanvasElement
  readBlob: (blob: Blob) => Promise<string>
}

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function supportedReceiptFile(file: File) {
  if (SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase())) return true
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
}

export function validateReceiptFile(file: File) {
  if (file.size <= 0) throw new Error('Choose a receipt photo that is not empty.')
  if (file.size > MAX_RECEIPT_IMAGE_BYTES) throw new RangeError('Receipt photos must be 5 MB or smaller.')
  if (!supportedReceiptFile(file)) throw new Error('Choose a JPG, PNG, WebP, or HEIC receipt photo.')
}

async function defaultDecode(file: File): Promise<DecodedImage> {
  if ('createImageBitmap' in globalThis) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }) as Promise<DecodedImage>
  }
  const source = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('This browser could not open the receipt photo.'))
      image.src = source
    })
  } finally {
    URL.revokeObjectURL(source)
  }
}

function defaultReadBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('The receipt photo could not be encoded.'))
    reader.onerror = () => reject(new Error('The receipt photo could not be encoded.'))
    reader.readAsDataURL(blob)
  })
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob
      ? resolve(blob)
      : reject(new Error('The receipt photo could not be compressed.')), 'image/jpeg', 0.82)
  })
}

export async function prepareReceiptImage(
  file: File,
  dependencies: Partial<ReceiptImageDependencies> = {},
): Promise<PreparedReceiptImage> {
  validateReceiptFile(file)
  const decode = dependencies.decode ?? defaultDecode
  const createCanvas = dependencies.createCanvas ?? (() => document.createElement('canvas'))
  const readBlob = dependencies.readBlob ?? defaultReadBlob

  let image: DecodedImage
  try {
    image = await decode(file)
  } catch (cause) {
    throw new Error('This browser could not read the photo. For HEIC images, try taking a new photo in Tally.', { cause })
  }
  try {
    const sourcePixels = image.width * image.height
    if (!Number.isFinite(sourcePixels) || image.width < 1 || image.height < 1) {
      throw new Error('The receipt photo has invalid dimensions.')
    }
    if (sourcePixels > MAX_RECEIPT_IMAGE_PIXELS) {
      throw new RangeError('The receipt photo resolution is too large.')
    }
    const scale = Math.min(1, MAX_RECEIPT_LONG_EDGE / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = createCanvas()
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('The browser could not prepare the receipt photo.')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const blob = await canvasToJpeg(canvas)
    if (blob.size > MAX_RECEIPT_UPLOAD_BYTES) {
      throw new RangeError('The compressed receipt photo is still too large.')
    }
    return { dataUrl: await readBlob(blob), width, height }
  } finally {
    image.close?.()
  }
}
