// Stamps: the part of the picture inside the loop, kept whole (background and all) on a white
// postage-stamp frame with perforated edges, instead of being cut out.

import { boundingBox, intersectRect, type Point } from './geometry'
import { canvasToBlob, createCanvas, type LoadedImage } from './image'
import { stickerScale, type StickerImage } from './sticker'

/** How a sticker is made: cut out around its subject, or framed whole as a stamp. */
export type StickerKind = 'cutout' | 'stamp'
export const STICKER_KINDS: StickerKind[] = ['cutout', 'stamp']

// The white margin, as a fraction of the picture's longest side, and the perforation holes'
// radius and spacing as fractions of the margin.
const MARGIN_RATIO = 0.075
const MIN_MARGIN = 14
const HOLE_RATIO = 0.3
const PITCH_RATIO = 0.85

export interface StampLayout {
  /** The whole stamp, frame included. */
  width: number
  height: number
  /** The white margin around the picture; the picture sits at (margin, margin). */
  margin: number
  /** Radius of the perforation holes. */
  radius: number
  /** Centres of the holes, which sit on the stamp's edge so each bites a half circle out of it. */
  holes: Point[]
}

/** Where everything goes on a stamp around a picture of `width` × `height` px. Pure, for tests. */
export function stampLayout(width: number, height: number): StampLayout {
  const margin = Math.max(MIN_MARGIN, Math.round(Math.max(width, height) * MARGIN_RATIO))
  const radius = margin * HOLE_RATIO
  const outerWidth = width + margin * 2
  const outerHeight = height + margin * 2
  const pitch = margin * PITCH_RATIO
  // A whole number of gaps on each side, so there's a hole on every corner, like a real sheet of stamps.
  const across = Math.max(2, Math.round(outerWidth / pitch))
  const down = Math.max(2, Math.round(outerHeight / pitch))
  const holes: Point[] = []
  for (let i = 0; i <= across; i++) {
    const x = (i / across) * outerWidth
    holes.push({ x, y: 0 }, { x, y: outerHeight })
  }
  for (let j = 1; j < down; j++) {
    const y = (j / down) * outerHeight
    holes.push({ x: 0, y }, { x: outerWidth, y })
  }
  return { width: outerWidth, height: outerHeight, margin, radius, holes }
}

/** Frames the part of the picture around `loop` (in image pixels) as a stamp. */
export async function createStamp(image: LoadedImage, loop: Point[]): Promise<StickerImage> {
  const crop = intersectRect(boundingBox(loop), { x: 0, y: 0, width: image.width, height: image.height })
  if (crop.width < 1 || crop.height < 1) throw new Error('That loop is outside the picture')
  const scale = stickerScale(Math.max(crop.width, crop.height))
  const width = Math.max(1, Math.round(crop.width * scale))
  const height = Math.max(1, Math.round(crop.height * scale))
  const layout = stampLayout(width, height)

  const canvas = createCanvas(Math.ceil(layout.width), Math.ceil(layout.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')

  // The paper, with the perforations punched out of its edges.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  for (const { x, y } of layout.holes) {
    ctx.moveTo(x + layout.radius, y)
    ctx.arc(x, y, layout.radius, 0, Math.PI * 2)
  }
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'

  // The picture, with a hairline so light pictures still have an edge against the paper.
  const { margin } = layout
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.source, crop.x, crop.y, crop.width, crop.height, margin, margin, width, height)
  ctx.strokeStyle = 'rgba(31, 24, 48, 0.14)'
  ctx.lineWidth = Math.max(1, margin / 14)
  ctx.strokeRect(margin, margin, width, height)

  return { blob: await canvasToBlob(canvas), width: canvas.width, height: canvas.height }
}
