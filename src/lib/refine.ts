// Edge refinement for cut-outs: makes a coarse subject mask follow the real edges in the picture,
// and cleans background colour out of the edge pixels. Pure functions, no DOM.

import { distanceTransform } from './outline'

/** Mean over a (2r+1)² window, with the window clipped at the image edges. */
export function boxMean(src: Float32Array, width: number, height: number, r: number): Float32Array<ArrayBuffer> {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = 0; x <= Math.min(r, width - 1); x++) sum += src[row + x]
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - r)
      const hi = Math.min(width - 1, x + r)
      tmp[row + x] = sum / (hi - lo + 1)
      if (x + r + 1 < width) sum += src[row + x + r + 1]
      if (x - r >= 0) sum -= src[row + x - r]
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = 0; y <= Math.min(r, height - 1); y++) sum += tmp[y * width + x]
    for (let y = 0; y < height; y++) {
      const lo = Math.max(0, y - r)
      const hi = Math.min(height - 1, y + r)
      out[y * width + x] = sum / (hi - lo + 1)
      if (y + r + 1 < height) sum += tmp[(y + r + 1) * width + x]
      if (y - r >= 0) sum -= tmp[(y - r) * width + x]
    }
  }
  return out
}

/** Averages `step`×`step` blocks into one pixel. */
function shrink(src: Float32Array, width: number, height: number, step: number) {
  const w = Math.ceil(width / step)
  const h = Math.ceil(height / step)
  const out = new Float32Array(w * h)
  const count = new Float32Array(w * h)
  for (let y = 0; y < height; y++) {
    const oy = Math.floor(y / step) * w
    for (let x = 0; x < width; x++) {
      const o = oy + Math.floor(x / step)
      out[o] += src[y * width + x]
      count[o]++
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= count[i]
  return out
}

/** Bilinear upsampling of a `shrink`ed image back to full size. */
function grow(src: Float32Array, w: number, h: number, width: number, height: number, step: number) {
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / step - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(h - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < width; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / step - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(w - 1, x0 + 1)
      const fx = sx - x0
      const top = src[y0 * w + x0] * (1 - fx) + src[y0 * w + x1] * fx
      const bottom = src[y1 * w + x0] * (1 - fx) + src[y1 * w + x1] * fx
      out[y * width + x] = top * (1 - fy) + bottom * fy
    }
  }
  return out
}

/**
 * Window statistics of the RGB values of pixels with `weight` 1 over a (2r+1)² window: means of
 * R, G, B and R²+G²+B², and of the weight itself (N, 0 where there are no such pixels).
 */
function maskedColorStats(rgba: Uint8ClampedArray, weight: Uint8Array, width: number, height: number, r: number) {
  const size = width * height
  const step = 2
  const w = Math.ceil(width / step)
  const h = Math.ceil(height / step)
  const R = new Float32Array(size)
  const G = new Float32Array(size)
  const B = new Float32Array(size)
  const S = new Float32Array(size)
  const N = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    if (!weight[i]) continue
    const r0 = rgba[i * 4]
    const g0 = rgba[i * 4 + 1]
    const b0 = rgba[i * 4 + 2]
    R[i] = r0
    G[i] = g0
    B[i] = b0
    S[i] = r0 * r0 + g0 * g0 + b0 * b0
    N[i] = 1
  }
  // Window statistics are smooth, so compute them at half resolution.
  const rr = Math.max(1, Math.round(r / step))
  const mean = (a: Float32Array) => grow(boxMean(shrink(a, width, height, step), w, h, rr), w, h, width, height, step)
  return { R: mean(R), G: mean(G), B: mean(B), S: mean(S), N: mean(N) }
}

// How clearly the subject and background colours must differ, relative to how much each varies,
// before colour is trusted over the model: below LOW not at all, above HIGH fully.
const SEPARATION_LOW = 1.5
const SEPARATION_HIGH = 3

/**
 * Re-estimates opacity along the mask's edge from colour: within `band` px of the edge, each pixel's
 * colour is placed between the nearby solid-subject colour and the nearby background colour. Sharp
 * edges in the picture become sharp cut lines; soft ones (fur) stay soft. Where subject and
 * background look alike, or the background is too busy to have one colour, the model's mask is kept.
 */
export function colorMatte(
  rgba: Uint8ClampedArray,
  mask: Float32Array,
  width: number,
  height: number,
  band: number,
): Float32Array<ArrayBuffer> {
  const size = width * height
  const inside = new Uint8Array(size)
  const outside = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    if (rgba[i * 4 + 3] === 0) continue
    if (mask[i] >= 0.5) inside[i] = 1
    else outside[i] = 1
  }
  // Distance of each pixel from the mask's edge, measured from whichever side it's on.
  const toOutside = distanceTransform(outside, width, height)
  const toInside = distanceTransform(inside, width, height)
  const band2 = band * band
  const sureSubject = new Uint8Array(size)
  const sureBackground = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    if (inside[i] && toOutside[i] > band2) sureSubject[i] = 1
    if (outside[i] && toInside[i] > band2) sureBackground[i] = 1
  }

  const reach = band * 3
  const fg = maskedColorStats(rgba, sureSubject, width, height, reach)
  const bg = maskedColorStats(rgba, sureBackground, width, height, reach)
  const out = Float32Array.from(mask)
  for (let i = 0; i < size; i++) {
    const inBand = inside[i] ? toOutside[i] <= band2 : outside[i] ? toInside[i] <= band2 : false
    if (!inBand || fg.N[i] < 0.01 || bg.N[i] < 0.01) continue
    const fr = fg.R[i] / fg.N[i]
    const fgG = fg.G[i] / fg.N[i]
    const fb = fg.B[i] / fg.N[i]
    const br = bg.R[i] / bg.N[i]
    const bgG = bg.G[i] / bg.N[i]
    const bb = bg.B[i] / bg.N[i]
    const dr = fr - br
    const dg = fgG - bgG
    const db = fb - bb
    const contrast2 = dr * dr + dg * dg + db * db
    // Spread (standard deviation) of each side's colours around its mean.
    const fgSpread = Math.sqrt(Math.max(0, fg.S[i] / fg.N[i] - (fr * fr + fgG * fgG + fb * fb)))
    const bgSpread = Math.sqrt(Math.max(0, bg.S[i] / bg.N[i] - (br * br + bgG * bgG + bb * bb)))
    const separation = Math.sqrt(contrast2) / (fgSpread + bgSpread + 10)
    const trust = Math.min(1, Math.max(0, (separation - SEPARATION_LOW) / (SEPARATION_HIGH - SEPARATION_LOW)))
    if (trust === 0) continue
    let a = ((rgba[i * 4] - br) * dr + (rgba[i * 4 + 1] - bgG) * dg + (rgba[i * 4 + 2] - bb) * db) / contrast2
    a = a < 0 ? 0 : a > 1 ? 1 : a
    out[i] = mask[i] + trust * (a - mask[i])
  }
  return out
}

/**
 * Replaces the colour of semi-transparent edge pixels with the colour of the nearby solid subject,
 * so background tints (a pink wall, green grass) don't show as a halo around the cut-out.
 * Alpha is left as is.
 */
export function decontaminate(rgba: Uint8ClampedArray, width: number, height: number, band = 4) {
  const size = width * height
  // Colour sums from pixels already known to be pure subject, grown outward one ring per pass.
  const known = new Uint8Array(size)
  const color = new Float32Array(size * 3)
  for (let i = 0; i < size; i++) {
    if (rgba[i * 4 + 3] >= 242) {
      known[i] = 1
      color[i * 3] = rgba[i * 4]
      color[i * 3 + 1] = rgba[i * 4 + 1]
      color[i * 3 + 2] = rgba[i * 4 + 2]
    }
  }
  for (let pass = 0; pass < band; pass++) {
    const next: number[] = []
    for (let i = 0; i < size; i++) {
      if (known[i] || rgba[i * 4 + 3] === 0) continue
      const x = i % width
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const y = Math.floor(i / width) + dy
        if (y < 0 || y >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const j = y * width + nx
          if (known[j] !== 1) continue
          r += color[j * 3]
          g += color[j * 3 + 1]
          b += color[j * 3 + 2]
          n++
        }
      }
      if (n) {
        color[i * 3] = r / n
        color[i * 3 + 1] = g / n
        color[i * 3 + 2] = b / n
        next.push(i)
      }
    }
    if (!next.length) break
    // Mark after the pass so each ring only learns from the previous one.
    for (const i of next) known[i] = 1
  }
  for (let i = 0; i < size; i++) {
    const a = rgba[i * 4 + 3]
    if (a === 0 || a >= 242 || !known[i]) continue
    rgba[i * 4] = color[i * 3]
    rgba[i * 4 + 1] = color[i * 3 + 1]
    rgba[i * 4 + 2] = color[i * 3 + 2]
  }
}

export interface Rgb {
  r: number
  g: number
  b: number
}

const colorDistance = (data: Uint8ClampedArray, i: number, c: Rgb) => {
  const dr = data[i * 4] - c.r
  const dg = data[i * 4 + 1] - c.g
  const db = data[i * 4 + 2] - c.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

// How far (in RGB units) a pixel may be from the backdrop colour and still count as backdrop.
// Loose enough for JPEG noise, tight enough to keep pale skin and light shading.
const BACKDROP_TOLERANCE = 28

/**
 * The colour of the backdrop around the subject if it's flat (a white page, a studio wall), or null
 * for real scenes. Looks at visible pixels the mask says are background.
 */
export function flatBackdrop(rgba: Uint8ClampedArray, mask: Float32Array, width: number, height: number): Rgb | null {
  const size = width * height
  const step = Math.max(1, Math.floor(size / 20000))
  const samples: number[] = []
  for (let i = 0; i < size; i += step) {
    if (mask[i] < 0.05 && rgba[i * 4 + 3] === 255) samples.push(i)
  }
  if (samples.length < 50) return null
  const median = (channel: number) => {
    const values = samples.map((i) => rgba[i * 4 + channel]).sort((a, b) => a - b)
    return values[values.length >> 1]
  }
  const color = { r: median(0), g: median(1), b: median(2) }
  const close = samples.filter((i) => colorDistance(rgba, i, color) < BACKDROP_TOLERANCE).length
  return close / samples.length >= 0.75 ? color : null
}

/**
 * Removes backdrop-coloured pixels that are connected to the backdrop, wherever the mask spilled
 * over them (gaps between legs, blobs along edges). Regions of the same colour enclosed by the
 * subject's outline, like white gloves, aren't reachable and stay. Edges get soft alpha from how
 * close their colour is to the backdrop.
 */
export function keyOutBackdrop(
  rgba: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
  backdrop: Rgb,
) {
  const size = width * height
  const isBackdrop = new Uint8Array(size)
  const stack = new Int32Array(size)
  let top = 0
  const visit = (i: number) => {
    if (isBackdrop[i] || rgba[i * 4 + 3] === 0) return
    if (colorDistance(rgba, i, backdrop) >= BACKDROP_TOLERANCE) return
    isBackdrop[i] = 1
    stack[top++] = i
  }
  // Start from what's already background: the frame edge and everything the mask left out.
  for (let i = 0; i < size; i++) {
    const x = i % width
    const onEdge = x === 0 || x === width - 1 || i < width || i >= size - width
    if (onEdge || alpha[i] < 0.05) visit(i)
  }
  while (top > 0) {
    const i = stack[--top]
    const x = i % width
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < size - width) visit(i + width)
  }

  for (let i = 0; i < size; i++) {
    if (isBackdrop[i]) {
      alpha[i] = 0
      continue
    }
    // Anti-alias pixels bordering the backdrop by colour: half-way colours get half opacity.
    const x = i % width
    const nearBackdrop =
      (x > 0 && isBackdrop[i - 1]) ||
      (x < width - 1 && isBackdrop[i + 1]) ||
      (i >= width && isBackdrop[i - width]) ||
      (i < size - width && isBackdrop[i + width])
    if (nearBackdrop) {
      const t = Math.min(1, Math.max(0, (colorDistance(rgba, i, backdrop) - BACKDROP_TOLERANCE) / 60))
      alpha[i] = Math.min(alpha[i], 0.35 + 0.65 * t)
    }
  }
}
