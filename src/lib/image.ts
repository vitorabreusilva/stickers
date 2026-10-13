import { IMAGE_TYPES, MAX_IMAGE_BYTES } from './sync-protocol'

export interface LoadedImage {
  source: HTMLCanvasElement
  width: number
  height: number
  /** The picture as it was given, and its full size (`source` may be scaled down). */
  original: { blob: Blob; width: number; height: number }
}

// Big enough for crisp crops, small enough to stay inside mobile Safari's canvas memory budget.
const MAX_EDGE = 3072

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** Decodes any image the browser understands (EXIF orientation applied) into a canvas we can draw from. */
export async function loadImage(blob: Blob): Promise<LoadedImage> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('This file is not an image we can open'))
      img.src = url
    })
    const { naturalWidth, naturalHeight } = img
    if (!naturalWidth || !naturalHeight) throw new Error('This image has no size')

    const scale = Math.min(1, MAX_EDGE / Math.max(naturalWidth, naturalHeight))
    const width = Math.max(1, Math.round(naturalWidth * scale))
    const height = Math.max(1, Math.round(naturalHeight * scale))
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height)
    return { source: canvas, width, height, original: { blob, width: naturalWidth, height: naturalHeight } }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), type, quality)
  })
}

const JPEG_QUALITIES = [0.92, 0.85, 0.75, 0.6]

/**
 * The original picture, to keep with a sticker. The file itself when it's a common format small
 * enough to sync; otherwise the editing copy as a JPEG, so it can still follow the sticker around.
 */
export async function keepableOriginal(image: LoadedImage): Promise<Blob> {
  const { blob } = image.original
  if (IMAGE_TYPES.includes(blob.type) && blob.size <= MAX_IMAGE_BYTES) return blob
  let smallest: Blob | undefined
  for (const quality of JPEG_QUALITIES) {
    smallest = await canvasToBlob(image.source, 'image/jpeg', quality)
    if (smallest.size <= MAX_IMAGE_BYTES) break
  }
  return smallest!
}
