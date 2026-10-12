import type { SubjectMask } from './cutout'
import { boundingBox, intersectRect, type Point, type Rect } from './geometry'
import { canvasToBlob, createCanvas, type LoadedImage } from './image'
import { addOutline, opaqueBounds } from './outline'
import { matteOnBackdrop } from './backdrop'
import { keepMainBlobs } from './mask'
import { colorMatte, decontaminate, flatBackdrop, keyOutBackdrop } from './refine'

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

/** The mask as a canvas whose alpha channel is the subject's opacity. */
function maskCanvas(subject: SubjectMask): HTMLCanvasElement {
  const canvas = createCanvas(subject.width, subject.height)
  const pixels = new ImageData(subject.width, subject.height)
  for (let i = 0; i < subject.alpha.length; i++) pixels.data[i * 4 + 3] = Math.round(subject.alpha[i] * 255)
  canvas.getContext('2d')!.putImageData(pixels, 0, 0)
  return canvas
}

const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

export interface Cut {
  pixels: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
  /** The part of the picture the cut-out covers, in image pixels. */
  crop: Rect
}

// The cut-out doesn't depend on the border, so switching borders reuses it.
const cuts = new WeakMap<object, Cut>()

/**
 * The cut-out without a border, at sticker resolution. With a `subject` mask it's the subject alone,
 * with its edges snapped to the picture; otherwise it's everything inside `loop` (in image pixels).
 */
export function cutOut(image: LoadedImage, loop: Point[], subject?: SubjectMask): Cut {
  const key = subject ?? loop
  const cached = cuts.get(key)
  if (cached) return cached

  const region = subject ? subjectBounds(subject) : boundingBox(loop)
  const crop = intersectRect(region, { x: 0, y: 0, width: image.width, height: image.height })
  if (crop.width < 1 || crop.height < 1) throw new Error('That loop is outside the picture')

  const longest = Math.max(crop.width, crop.height)
  const scale = Math.min(MAX_SIZE / longest, Math.max(1, MIN_SIZE / longest))
  const width = Math.max(1, Math.round(crop.width * scale))
  const height = Math.max(1, Math.round(crop.height * scale))

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available')
  ctx.imageSmoothingQuality = 'high'
  ctx.scale(scale, scale)
  ctx.translate(-crop.x, -crop.y)
  ctx.beginPath()
  if (subject) {
    const { x, y, width: w, height: h } = subject.rect
    ctx.rect(x, y, w, h)
    ctx.clip()
  } else {
    traceLoop(ctx, loop)
    ctx.clip('evenodd')
  }
  ctx.drawImage(image.source, 0, 0, image.width, image.height)
  const { data } = ctx.getImageData(0, 0, width, height)

  if (subject) {
    // The model's mask is coarse: upscale it, then let the picture's own edges decide where it ends.
    ctx.clearRect(-1e5, -1e5, 2e5, 2e5)
    const { x, y, width: w, height: h } = subject.rect
    ctx.drawImage(maskCanvas(subject), x, y, w, h)
    const maskPixels = ctx.getImageData(0, 0, width, height).data
    const coarse = new Float32Array(width * height)
    for (let i = 0; i < coarse.length; i++) coarse[i] = maskPixels[i * 4 + 3] / 255

    // The model's edge can be off by about one of its own pixels, which is several of ours.
    const band = Math.max(3, Math.round(Math.max(width, height) / 80))
    const refined = colorMatte(data, coarse, width, height, band)
    for (let i = 0; i < refined.length; i++) refined[i] = smoothstep(0.2, 0.8, refined[i])
    // On a flat backdrop (clip art, product shots) the picture itself says exactly where the subject
    // ends, so cut away any backdrop the model's mask spilled onto.
    const backdrop = flatBackdrop(data, coarse, width, height)
    if (backdrop) keyOutBackdrop(data, refined, width, height, backdrop)
    // Watermarks and ground lines left floating once the backdrop is gone.
    keepMainBlobs(refined, width, height)
    for (let i = 0; i < refined.length; i++) data[i * 4 + 3] = Math.round(refined[i] * data[i * 4 + 3])
    decontaminate(data, width, height)
  }

  const cut = { pixels: data, width, height, crop }
  cuts.set(key, cut)
  return cut
}

// Room around the loop for sampling the backdrop.
const BACKDROP_MARGIN = 0.08
const backdropCuts = new WeakMap<Point[], Cut | null>()

/**
 * The subject inside `loop` cut out exactly, if the picture has a plain backdrop around it (clip
 * art on a white page, a product on a studio wall). Null otherwise. Takes well under a second.
 */
export function backdropCut(image: LoadedImage, loop: Point[]): Cut | null {
  const cached = backdropCuts.get(loop)
  if (cached !== undefined) return cached

  const box = boundingBox(loop)
  const crop = intersectRect(
    {
      x: box.x - box.width * BACKDROP_MARGIN,
      y: box.y - box.height * BACKDROP_MARGIN,
      width: box.width * (1 + 2 * BACKDROP_MARGIN),
      height: box.height * (1 + 2 * BACKDROP_MARGIN),
    },
    { x: 0, y: 0, width: image.width, height: image.height },
  )
  let cut: Cut | null = null
  if (crop.width >= 8 && crop.height >= 8) {
    const longest = Math.max(crop.width, crop.height)
    const scale = Math.min(MAX_SIZE / longest, Math.max(1, MIN_SIZE / longest))
    const width = Math.max(1, Math.round(crop.width * scale))
    const height = Math.max(1, Math.round(crop.height * scale))
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas is not available')
    ctx.imageSmoothingQuality = 'high'
    ctx.scale(scale, scale)
    ctx.translate(-crop.x, -crop.y)
    ctx.drawImage(image.source, 0, 0, image.width, image.height)
    const { data } = ctx.getImageData(0, 0, width, height)

    // The loop, rasterised at the same scale.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.scale(scale, scale)
    ctx.translate(-crop.x, -crop.y)
    ctx.beginPath()
    traceLoop(ctx, loop)
    ctx.fillStyle = '#000'
    ctx.fill('evenodd')
    const loopPixels = ctx.getImageData(0, 0, width, height).data
    const inside = new Uint8Array(width * height)
    for (let i = 0; i < inside.length; i++) inside[i] = loopPixels[i * 4 + 3] >= 128 ? 1 : 0

    const matte = matteOnBackdrop(data, width, height, inside)
    if (matte) cut = { pixels: matte.rgba, width, height, crop }
  }
  backdropCuts.set(loop, cut)
  return cut
}

/** How the subject was found: exactly on a plain backdrop, or by the segmentation model. */
export type Selection = { kind: 'backdrop'; cut: Cut } | { kind: 'mask'; mask: SubjectMask }

/**
 * Cuts a sticker out of the image and gives it a white die-cut border. With a `selection` the
 * sticker is the subject alone; otherwise it's everything inside `loop` (in image pixels).
 */
export async function createSticker(
  image: LoadedImage,
  loop: Point[],
  outline: OutlineSize,
  selection?: Selection,
): Promise<StickerImage> {
  const cut = selection?.kind === 'backdrop' ? selection.cut : cutOut(image, loop, selection?.mask)
  const radius =
    outline === 'none' ? 0 : Math.max(3, Math.round(Math.max(cut.width, cut.height) * OUTLINE_RATIO[outline]))
  const pad = radius + 2

  // Place the cut-out in a transparent frame with room for the border.
  const width = cut.width + pad * 2
  const height = cut.height + pad * 2
  const framed = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < cut.height; y++) {
    const from = y * cut.width * 4
    framed.set(cut.pixels.subarray(from, from + cut.width * 4), ((y + pad) * width + pad) * 4)
  }

  const stickered = addOutline(framed, width, height, radius)
  const bounds = opaqueBounds(stickered, width, height)
  if (!bounds) throw new Error('There is nothing inside that loop')

  const result = createCanvas(bounds.width, bounds.height)
  result.getContext('2d')!.putImageData(new ImageData(stickered, width, height), -bounds.x, -bounds.y)
  const blob = await canvasToBlob(result)
  return { blob, width: bounds.width, height: bounds.height }
}
