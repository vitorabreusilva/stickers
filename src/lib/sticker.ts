import type { SubjectMask } from './cutout'
import { boundingBox, intersectRect, type Point, type Rect } from './geometry'
import { canvasToBlob, createCanvas, type LoadedImage } from './image'
import { addOutline, opaqueBounds } from './outline'

export type OutlineSize = 'none' | 'thin' | 'thick'

export const OUTLINE_SIZES: OutlineSize[] = ['none', 'thin', 'thick']

// Border width as a fraction of the sticker's longest side.
const OUTLINE_RATIO: Record<OutlineSize, number> = { none: 0, thin: 0.02, thick: 0.045 }

// Longest side of the cut-out before the border is added. Small crops are scaled up so they share well.
const MAX_SIZE = 1024
const MIN_SIZE = 512

export interface StickerImage {
  blob: Blob
  width: number
  height: number
}

export function traceLoop(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.closePath()
}

/** Where the subject is, in image pixels, with a pixel of slack for the mask's soft edge. */
function subjectBounds(subject: SubjectMask): Rect {
  const sx = subject.rect.width / subject.width
  const sy = subject.rect.height / subject.height
  return {
    x: subject.rect.x + (subject.bounds.x - 1) * sx,
    y: subject.rect.y + (subject.bounds.y - 1) * sy,
    width: (subject.bounds.width + 2) * sx,
    height: (subject.bounds.height + 2) * sy,
  }
}

const maskCanvases = new WeakMap<SubjectMask, HTMLCanvasElement>()

/** The mask as a canvas whose alpha channel is the subject's opacity. */
function maskCanvas(subject: SubjectMask): HTMLCanvasElement {
  let canvas = maskCanvases.get(subject)
  if (!canvas) {
    canvas = createCanvas(subject.width, subject.height)
    const pixels = new ImageData(subject.width, subject.height)
    for (let i = 0; i < subject.alpha.length; i++) pixels.data[i * 4 + 3] = Math.round(subject.alpha[i] * 255)
    canvas.getContext('2d')!.putImageData(pixels, 0, 0)
    maskCanvases.set(subject, canvas)
  }
  return canvas
}

/**
 * Cuts a sticker out of the image and gives it a white die-cut border. With a `subject` mask the
 * sticker is the subject alone; otherwise it's everything inside `loop` (in image pixels).
 */
export async function createSticker(
  image: LoadedImage,
  loop: Point[],
  outline: OutlineSize,
  subject?: SubjectMask,
): Promise<StickerImage> {
  const region = subject ? subjectBounds(subject) : boundingBox(loop)
  const crop = intersectRect(region, { x: 0, y: 0, width: image.width, height: image.height })
  if (crop.width < 1 || crop.height < 1) throw new Error('That loop is outside the picture')

  const longest = Math.max(crop.width, crop.height)
  const scale = Math.min(MAX_SIZE / longest, Math.max(1, MIN_SIZE / longest))
  const width = Math.max(1, Math.round(crop.width * scale))
  const height = Math.max(1, Math.round(crop.height * scale))
  const radius = outline === 'none' ? 0 : Math.max(3, Math.round(Math.max(width, height) * OUTLINE_RATIO[outline]))
  const pad = radius + 2

  const work = createCanvas(width + pad * 2, height + pad * 2)
  const ctx = work.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available')
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(pad, pad)
  ctx.scale(scale, scale)
  ctx.translate(-crop.x, -crop.y)
  if (subject) {
    const { x, y, width: w, height: h } = subject.rect
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.drawImage(image.source, 0, 0, image.width, image.height)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.drawImage(maskCanvas(subject), x, y, w, h)
    ctx.globalCompositeOperation = 'source-over'
  } else {
    ctx.beginPath()
    traceLoop(ctx, loop)
    ctx.clip('evenodd')
    ctx.drawImage(image.source, 0, 0, image.width, image.height)
  }

  const pixels = ctx.getImageData(0, 0, work.width, work.height)
  const stickered = addOutline(pixels.data, work.width, work.height, radius)
  const bounds = opaqueBounds(stickered, work.width, work.height)
  if (!bounds) throw new Error('There is nothing inside that loop')

  const result = createCanvas(bounds.width, bounds.height)
  result.getContext('2d')!.putImageData(new ImageData(stickered, work.width, work.height), -bounds.x, -bounds.y)
  const blob = await canvasToBlob(result)
  return { blob, width: bounds.width, height: bounds.height }
}
