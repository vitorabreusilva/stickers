import type { Rect } from './geometry'
import { distanceTransform, opaqueBounds } from './outline'

export interface RefinedMask {
  /** Opacity 0..1 per pixel. */
  alpha: Float32Array<ArrayBuffer>
  /** Smallest rect containing every visible pixel. */
  bounds: Rect
  /** Fraction of the whole image the model marked as subject, before cleanup. */
  coverage: number
}

// Blobs smaller than this fraction of the biggest one are specks, not part of the subject.
const MIN_BLOB_RATIO = 0.08
// Below this fraction of the image there's no real subject.
const MIN_SUBJECT_FRACTION = 0.001
// Soft edge pixels are kept this close (in px) to the subject, so faint halos elsewhere disappear.
const EDGE_REACH = 2

const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/** Labels 4-connected blobs of `on` pixels. Returns per-pixel labels (0 = off) and each label's area. */
function labelBlobs(on: Uint8Array, width: number, height: number) {
  const size = width * height
  const labels = new Int32Array(size)
  const areas = [0]
  const stack = new Int32Array(size)
  for (let start = 0; start < size; start++) {
    if (!on[start] || labels[start]) continue
    const label = areas.length
    let area = 0
    let top = 0
    stack[top++] = start
    labels[start] = label
    const visit = (n: number) => {
      if (on[n] && !labels[n]) {
        labels[n] = label
        stack[top++] = n
      }
    }
    while (top > 0) {
      const i = stack[--top]
      area++
      const x = i % width
      if (x > 0) visit(i - 1)
      if (x < width - 1) visit(i + 1)
      if (i >= width) visit(i - width)
      if (i < size - width) visit(i + width)
    }
    areas.push(area)
  }
  return { labels, areas }
}

/**
 * Turns a model's raw confidence mask into a clean sticker mask: crisp but anti-aliased edges,
 * only the main subject (stray specks dropped), and no faint haze. Null if there's no subject.
 */
export function refineMask(confidence: Float32Array, width: number, height: number): RefinedMask | null {
  const size = width * height
  const core = new Uint8Array(size)
  let coreArea = 0
  for (let i = 0; i < size; i++) {
    core[i] = confidence[i] >= 0.5 ? 1 : 0
    coreArea += core[i]
  }

  const { labels, areas } = labelBlobs(core, width, height)
  let largest = 0
  for (const area of areas) if (area > largest) largest = area
  if (largest < size * MIN_SUBJECT_FRACTION) return null

  const keep = new Uint8Array(size)
  for (let i = 0; i < size; i++) keep[i] = labels[i] && areas[labels[i]] >= largest * MIN_BLOB_RATIO ? 1 : 0

  const dist2 = distanceTransform(keep, width, height)
  const reach2 = EDGE_REACH * EDGE_REACH
  const alpha = new Float32Array(size)
  const rgba = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    if (dist2[i] > reach2) continue
    const a = smoothstep(0.25, 0.75, confidence[i])
    alpha[i] = a
    rgba[i * 4 + 3] = Math.round(a * 255)
  }

  const bounds = opaqueBounds(rgba, width, height)
  return bounds ? { alpha, bounds, coverage: coreArea / size } : null
}
