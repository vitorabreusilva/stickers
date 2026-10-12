// Turns a sticker into line art for a coloring page. Pure pixel operations, so they run in tests.
//
// The picture is split into flat areas of similar colour (k-means in Lab, then neighbouring areas
// that look alike are merged and crumbs are folded into their neighbours). Lines go where two areas
// meet, where the artwork already has dark ink lines, and, thicker, around the sticker's outline.
// Lines are kept as distance fields so they can be drawn smooth at print resolution.

import { distanceTransform } from './outline'

export type ColoringDetail = 'simple' | 'medium' | 'detailed'
export const COLORING_DETAILS: ColoringDetail[] = ['simple', 'medium', 'detailed']

interface DetailSettings {
  /** Colour clusters before merging. */
  colors: number
  /** Neighbouring areas closer than this (CIE76 ΔE) become one. */
  mergeDelta: number
  /** Areas smaller than this fraction of the sticker are folded into a neighbour. */
  minArea: number
  /** How much darker than its surroundings (L*, 0–100) a pixel must be to count as an ink line. */
  inkContrast: number
}

const SETTINGS: Record<ColoringDetail, DetailSettings> = {
  simple: { colors: 6, mergeDelta: 20, minArea: 0.004, inkContrast: 16 },
  medium: { colors: 10, mergeDelta: 14, minArea: 0.0015, inkContrast: 12 },
  detailed: { colors: 16, mergeDelta: 9, minArea: 0.0005, inkContrast: 9 },
}

/** Line widths in millimetres on paper, per detail level. */
export const LINE_WIDTHS_MM: Record<ColoringDetail, { line: number; outline: number }> = {
  simple: { line: 0.75, outline: 1.3 },
  medium: { line: 0.55, outline: 1.1 },
  detailed: { line: 0.4, outline: 0.9 },
}

/** Distance, in source pixels, from every pixel to the nearest line of each kind. */
export interface LineFields {
  width: number
  height: number
  /** Borders between flat areas. */
  regions: Float32Array
  /** Dark lines drawn in the artwork itself: signed distance to their edge (negative inside). */
  ink: Float32Array
  /** The sticker's silhouette, where the artwork has no outline of its own. */
  outline: Float32Array
  /** Where the drawing is, in field pixels. */
  bounds: Rect
}

// Stickers are often small cut-outs of low-resolution pictures. Lines are found on the sticker
// enlarged to about this size, so edges land between the original pixels and curves stay smooth.
const WORK_SIZE = 1400
const MAX_UPSCALE = 3

// sRGB → Lab (D65), via lookup for the transfer curve.
const LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)

/** Lab of each pixel, laid over white, plus which pixels belong to the sticker. */
export function toLab(rgba: Uint8ClampedArray, width: number, height: number) {
  const size = width * height
  const L = new Float32Array(size)
  const A = new Float32Array(size)
  const B = new Float32Array(size)
  const inside = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    const j = i * 4
    const alpha = rgba[j + 3] / 255
    inside[i] = rgba[j + 3] >= 128 ? 1 : 0
    const over = (c: number) => LINEAR[Math.round(c * alpha + 255 * (1 - alpha))]
    const r = over(rgba[j])
    const g = over(rgba[j + 1])
    const b = over(rgba[j + 2])
    const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
    const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b)
    const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
    L[i] = 116 * fy - 16
    A[i] = 500 * (fx - fy)
    B[i] = 200 * (fy - fz)
  }
  return { L, A, B, inside }
}

/** Separable Gaussian blur with clamped edges. */
export function gaussianBlur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return src.slice()
  const radius = Math.ceil(sigma * 3)
  const kernel = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let k = -radius; k <= radius; k++) sum += kernel[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma))
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum

  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k >= width ? width - 1 : x + k
        acc += src[row + xx] * kernel[k + radius]
      }
      tmp[row + x] = acc
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k >= height ? height - 1 : y + k
        acc += tmp[yy * width + x] * kernel[k + radius]
      }
      out[y * width + x] = acc
    }
  }
  return out
}

/**
 * Resizes RGBA pixels with Catmull-Rom (bicubic) interpolation. Colours are weighted by opacity, so
 * transparent pixels don't darken the edges.
 */
export function resizeBicubic(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): Uint8ClampedArray<ArrayBuffer> {
  const weights = (t: number) => {
    const t2 = t * t
    const t3 = t2 * t
    return [
      -0.5 * t3 + t2 - 0.5 * t,
      1.5 * t3 - 2.5 * t2 + 1,
      -1.5 * t3 + 2 * t2 + 0.5 * t,
      0.5 * t3 - 0.5 * t2,
    ]
  }
  const taps = (n: number, outN: number) => {
    const index = new Int32Array(outN * 4)
    const weight = new Float32Array(outN * 4)
    for (let o = 0; o < outN; o++) {
      const x = ((o + 0.5) * n) / outN - 0.5
      const x0 = Math.floor(x)
      const w = weights(x - x0)
      for (let k = 0; k < 4; k++) {
        index[o * 4 + k] = Math.min(n - 1, Math.max(0, x0 - 1 + k))
        weight[o * 4 + k] = w[k]
      }
    }
    return { index, weight }
  }
  // Premultiplied channels, resized horizontally then vertically.
  const pre = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const a = src[i * 4 + 3] / 255
    pre[i * 4] = src[i * 4] * a
    pre[i * 4 + 1] = src[i * 4 + 1] * a
    pre[i * 4 + 2] = src[i * 4 + 2] * a
    pre[i * 4 + 3] = src[i * 4 + 3]
  }
  const h = taps(width, outWidth)
  const tmp = new Float32Array(outWidth * height * 4)
  for (let y = 0; y < height; y++) {
    for (let ox = 0; ox < outWidth; ox++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0
        for (let k = 0; k < 4; k++) acc += pre[(y * width + h.index[ox * 4 + k]) * 4 + c] * h.weight[ox * 4 + k]
        tmp[(y * outWidth + ox) * 4 + c] = acc
      }
    }
  }
  const v = taps(height, outHeight)
  const out = new Uint8ClampedArray(outWidth * outHeight * 4)
  for (let oy = 0; oy < outHeight; oy++) {
    for (let x = 0; x < outWidth; x++) {
      const px = [0, 0, 0, 0]
      for (let c = 0; c < 4; c++) {
        let acc = 0
        for (let k = 0; k < 4; k++) acc += tmp[(v.index[oy * 4 + k] * outWidth + x) * 4 + c] * v.weight[oy * 4 + k]
        px[c] = acc
      }
      const j = (oy * outWidth + x) * 4
      const a = Math.min(255, Math.max(0, px[3]))
      out[j + 3] = a
      if (a > 0) {
        out[j] = (px[0] * 255) / a
        out[j + 1] = (px[1] * 255) / a
        out[j + 2] = (px[2] * 255) / a
      }
    }
  }
  return out
}

/** The largest value within `radius` px (a square window), per pixel. */
function maxFilter(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const negated = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) negated[i] = -src[i]
  const out = minFilter(negated, width, height, radius)
  for (let i = 0; i < out.length; i++) out[i] = -out[i]
  return out
}

/** The smallest value within `radius` px (a square window), per pixel. */
function minFilter(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let m = Infinity
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) if (src[row + k] < m) m = src[row + k]
      tmp[row + x] = m
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let m = Infinity
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) if (tmp[k * width + x] < m) m = tmp[k * width + x]
      out[y * width + x] = m
    }
  }
  return out
}

/** Small deterministic PRNG, so the same sticker always gives the same page. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Groups pixels into connected components of `mask`, dropping those under `minSize` pixels. */
function dropSmallComponents(mask: Uint8Array, width: number, height: number, minSize: number) {
  const size = width * height
  const seen = new Uint8Array(size)
  const stack = new Int32Array(size)
  const members: number[] = []
  for (let start = 0; start < size; start++) {
    if (!mask[start] || seen[start]) continue
    members.length = 0
    let top = 0
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const i = stack[--top]
      members.push(i)
      const x = i % width
      // 8-connected, so diagonal strokes count as one line.
      for (let dy = -1; dy <= 1; dy++) {
        const y = (i - x) / width + dy
        if (y < 0 || y >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const n = y * width + xx
          if (mask[n] && !seen[n]) {
            seen[n] = 1
            stack[top++] = n
          }
        }
      }
    }
    if (members.length < minSize) for (const i of members) mask[i] = 0
  }
}

/**
 * Pixels that are clearly darker than their surroundings: the outlines and details an artist
 * inked. Wide dark areas aren't ink (they're as dark as what's around them); they become
 * areas to colour instead.
 */
export function findInk(
  L: Float32Array,
  inside: Uint8Array,
  chroma: Float32Array,
  width: number,
  height: number,
  contrast: number,
): Uint8Array {
  const scale = Math.max(width, height)
  const fine = gaussianBlur(L, width, height, Math.max(0.6, scale / 1400))
  const size = width * height
  // What the picture would look like without its strokes: a grey-level closing fills in dark
  // features up to a thick outline's width, but leaves the edge between two colour areas alone, so
  // only real strokes (darker than both sides) count.
  const reach = Math.max(3, Math.round(scale / 120))
  const unstroked = minFilter(maxFilter(fine, width, height, reach), width, height, reach)
  // A stroke is cut at half its depth, so pale thin lines keep their width instead of swelling
  // with their soft edges, and dark strokes keep their full weight.
  const darkest = minFilter(fine, width, height, Math.max(2, Math.round(scale / 300)))
  // Grainy pictures (photos, heavy compression) need a clearer stroke than clean artwork, or the
  // grain itself starts to look like strokes.
  const smoother = gaussianBlur(fine, width, height, Math.max(1.5, scale / 900))
  const grain: number[] = []
  for (let i = 0; i < size; i += 7) if (inside[i]) grain.push(Math.abs(fine[i] - smoother[i]))
  grain.sort((a, b) => a - b)
  contrast = Math.max(contrast, 8 * 1.48 * (grain[grain.length >> 1] ?? 0))
  const ink = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    if (!inside[i]) continue
    const depth = unstroked[i] - darkest[i]
    // A clear stroke, or simply black (cartoon outlines and solid black shapes; dark colours like
    // a deep red don't count).
    if ((fine[i] < 24 && chroma[i] < 15) || (depth > contrast && darkest[i] < 85 && fine[i] < unstroked[i] - depth / 2)) ink[i] = 1
  }
  // Close pinholes and hairline breaks in strokes (thin lines in small, compressed pictures
  // break up into dots once enlarged).
  const closed = erode(dilate(ink, width, height, Math.max(1, scale / 600)), width, height, Math.max(1, scale / 600))
  for (let i = 0; i < size; i++) if (closed[i] && inside[i]) ink[i] = 1
  dropSmallComponents(ink, width, height, Math.max(8, Math.round((scale * scale) / 150000)))
  return ink
}

/**
 * Solid black shapes: small ones (pupils, buttons) stay filled in, like in a printed coloring book;
 * big ones (black hair, a dark coat) are hollowed out to their outline so they can be coloured.
 * A shape's solid part is what's more than `lineRadius` px from its edge; it only counts if it's
 * more than `minSolid` px from the edge somewhere, so thick strokes aren't mistaken for shapes.
 */
export function hollowSolids(
  ink: Uint8Array,
  width: number,
  height: number,
  lineRadius: number,
  minSolid: number,
  maxFill: number,
): void {
  const size = width * height
  const paper = new Uint8Array(size)
  for (let i = 0; i < size; i++) paper[i] = ink[i] ? 0 : 1
  const fromPaper = distanceTransform(paper, width, height)
  const r2 = lineRadius * lineRadius
  const core = new Uint8Array(size)
  for (let i = 0; i < size; i++) if (ink[i] && fromPaper[i] > r2) core[i] = 1

  const seen = new Uint8Array(size)
  const stack = new Int32Array(size)
  const members: number[] = []
  for (let start = 0; start < size; start++) {
    if (!core[start] || seen[start]) continue
    members.length = 0
    let deepest = 0
    let top = 0
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const i = stack[--top]
      members.push(i)
      if (fromPaper[i] > deepest) deepest = fromPaper[i]
      const x = i % width
      const visit = (j: number) => {
        if (core[j] && !seen[j]) {
          seen[j] = 1
          stack[top++] = j
        }
      }
      if (x > 0) visit(i - 1)
      if (x < width - 1) visit(i + 1)
      if (i >= width) visit(i - width)
      if (i < size - width) visit(i + width)
    }
    // The core is the shape minus a line-wide rim. Thick outlines have long, thin cores; only
    // shapes wide in every direction and big overall are solids worth colouring in.
    if (deepest > minSolid * minSolid && members.length > maxFill) for (const i of members) ink[i] = 0
  }
}

/** Edge-preserving smoothing (Perona–Malik diffusion): flattens noise and shading, keeps edges. */
export function diffuse(
  channels: Float32Array[],
  width: number,
  height: number,
  iterations: number,
  edge: number,
): Float32Array[] {
  const size = width * height
  const n = channels.length
  let cur = channels.map((c) => c.slice())
  let next = channels.map((c) => c.slice())
  const k2 = edge * edge
  // Conductance across each pixel's right and bottom edge, shared by both sides.
  const right = new Float32Array(size)
  const down = new Float32Array(size)
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < size; i++) {
      const x = i % width
      let dr = 0
      let dd = 0
      for (let c = 0; c < n; c++) {
        const v = cur[c][i]
        if (x < width - 1) dr += (cur[c][i + 1] - v) ** 2
        if (i < size - width) dd += (cur[c][i + width] - v) ** 2
      }
      right[i] = x < width - 1 ? 1 / (1 + dr / k2) : 0
      down[i] = i < size - width ? 1 / (1 + dd / k2) : 0
    }
    for (let c = 0; c < n; c++) {
      const src = cur[c]
      const dst = next[c]
      for (let i = 0; i < size; i++) {
        const v = src[i]
        // Conductance is 0 only past the picture's edge.
        let flow = 0
        if (right[i]) flow += right[i] * (src[i + 1] - v)
        if (down[i]) flow += down[i] * (src[i + width] - v)
        if (i % width > 0) flow += right[i - 1] * (src[i - 1] - v)
        if (i >= width) flow += down[i - width] * (src[i - width] - v)
        dst[i] = v + 0.2 * flow
      }
    }
    ;[cur, next] = [next, cur]
  }
  return cur
}

/** Keeps only pixels at least `radius` px from any unset pixel. */
function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const inverse = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) inverse[i] = mask[i] ? 0 : 1
  const grown = dilate(inverse, width, height, radius)
  for (let i = 0; i < grown.length; i++) grown[i] = grown[i] ? 0 : 1
  return grown
}

/** Marks every pixel within `radius` px of a set pixel. */
function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const d2 = distanceTransform(mask, width, height)
  const out = new Uint8Array(mask.length)
  const r2 = radius * radius
  for (let i = 0; i < out.length; i++) out[i] = d2[i] <= r2 ? 1 : 0
  return out
}

/** k-means++ on a sample of the pixels; returns k Lab centres. */
function kmeans(L: Float32Array, A: Float32Array, B: Float32Array, pixels: Int32Array, k: number): Float32Array {
  const rand = mulberry32(pixels.length * 2654435761)
  const m = Math.min(pixels.length, 24000)
  const sample = new Int32Array(m)
  for (let s = 0; s < m; s++) sample[s] = pixels[m === pixels.length ? s : Math.floor(rand() * pixels.length)]

  k = Math.min(k, m)
  const centers = new Float32Array(k * 3)
  const d2 = new Float64Array(m).fill(Infinity)
  const setCenter = (c: number, i: number) => {
    centers[c * 3] = L[i]
    centers[c * 3 + 1] = A[i]
    centers[c * 3 + 2] = B[i]
  }
  setCenter(0, sample[Math.floor(rand() * m)])
  for (let c = 1; c < k; c++) {
    let total = 0
    for (let s = 0; s < m; s++) {
      const i = sample[s]
      const dl = L[i] - centers[(c - 1) * 3]
      const da = A[i] - centers[(c - 1) * 3 + 1]
      const db = B[i] - centers[(c - 1) * 3 + 2]
      const d = dl * dl + da * da + db * db
      if (d < d2[s]) d2[s] = d
      total += d2[s]
    }
    let pick = rand() * total
    let chosen = m - 1
    for (let s = 0; s < m; s++) {
      pick -= d2[s]
      if (pick <= 0) {
        chosen = s
        break
      }
    }
    setCenter(c, sample[chosen])
  }

  const assign = new Int32Array(m)
  const sums = new Float64Array(k * 4)
  for (let iter = 0; iter < 10; iter++) {
    sums.fill(0)
    for (let s = 0; s < m; s++) {
      const i = sample[s]
      const c = nearest(centers, k, L[i], A[i], B[i])
      assign[s] = c
      sums[c * 4] += L[i]
      sums[c * 4 + 1] += A[i]
      sums[c * 4 + 2] += B[i]
      sums[c * 4 + 3]++
    }
    for (let c = 0; c < k; c++) {
      const n = sums[c * 4 + 3]
      if (!n) continue
      centers[c * 3] = sums[c * 4] / n
      centers[c * 3 + 1] = sums[c * 4 + 1] / n
      centers[c * 3 + 2] = sums[c * 4 + 2] / n
    }
  }
  return centers
}

function nearest(centers: Float32Array, k: number, l: number, a: number, b: number): number {
  let best = 0
  let bestD = Infinity
  for (let c = 0; c < k; c++) {
    const dl = l - centers[c * 3]
    const da = a - centers[c * 3 + 1]
    const db = b - centers[c * 3 + 2]
    const d = dl * dl + da * da + db * db
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best
}

/** Replaces each label by the most common one around it, to clean up speckle. -1 is left alone. */
function majorityFilter(labels: Int32Array<ArrayBuffer>, width: number, height: number, k: number): Int32Array<ArrayBuffer> {
  const out = labels.slice()
  const counts = new Int32Array(k)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (labels[i] < 0) continue
      counts.fill(0)
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          const l = labels[yy * width + xx]
          if (l >= 0) counts[l]++
        }
      }
      let best = labels[i]
      for (let c = 0; c < k; c++) if (counts[c] > counts[best]) best = c
      out[i] = best
    }
  }
  return out
}

/**
 * Splits the sticker into flat areas to colour. Returns a region id per pixel, -1 outside the
 * sticker and on ink.
 */
export function segment(
  lab: { L: Float32Array; A: Float32Array; B: Float32Array },
  usable: Uint8Array,
  width: number,
  height: number,
  settings: Pick<DetailSettings, 'colors' | 'mergeDelta' | 'minArea'>,
): Int32Array {
  const size = width * height
  const scale = Math.max(width, height)
  const sigma = Math.max(0.6, scale / 1400)
  const [L, A, B] = diffuse(
    [lab.L, lab.A, lab.B].map((c) => gaussianBlur(c, width, height, sigma)),
    width,
    height,
    Math.round(Math.min(14, Math.max(8, scale / 60))),
    6,
  )

  let count = 0
  for (let i = 0; i < size; i++) count += usable[i]
  const pixels = new Int32Array(count)
  for (let i = 0, p = 0; i < size; i++) if (usable[i]) pixels[p++] = i
  const regions = new Int32Array(size).fill(-1)
  if (!count) return regions

  // 1. Quantize colours.
  const centers = kmeans(L, A, B, pixels, settings.colors)
  const k = centers.length / 3
  let clusters = new Int32Array(size).fill(-1)
  for (const i of pixels) clusters[i] = nearest(centers, k, L[i], A[i], B[i])
  clusters = majorityFilter(majorityFilter(clusters, width, height, k), width, height, k)

  // 2. Connected areas of one colour.
  const stack = new Int32Array(size)
  const area: number[] = []
  const sumL: number[] = []
  const sumA: number[] = []
  const sumB: number[] = []
  for (const start of pixels) {
    if (regions[start] >= 0) continue
    const id = area.length
    const c = clusters[start]
    let n = 0
    let sl = 0
    let sa = 0
    let sb = 0
    let top = 0
    stack[top++] = start
    regions[start] = id
    while (top > 0) {
      const i = stack[--top]
      n++
      sl += L[i]
      sa += A[i]
      sb += B[i]
      const x = i % width
      const visit = (j: number) => {
        if (regions[j] < 0 && clusters[j] === c) {
          regions[j] = id
          stack[top++] = j
        }
      }
      if (x > 0) visit(i - 1)
      if (x < width - 1) visit(i + 1)
      if (i >= width) visit(i - width)
      if (i < size - width) visit(i + width)
    }
    area.push(n)
    sumL.push(sl)
    sumA.push(sa)
    sumB.push(sb)
  }

  // Which areas touch, along how many pixels, and how much the colour actually changes across
  // that border (measured over three pixels, so slightly soft edges still count in full).
  const R = area.length
  const shared = new Map<number, number>()
  const contrast = new Map<number, number>()
  const step = (p: number, q: number) => Math.sqrt((L[p] - L[q]) ** 2 + (A[p] - A[q]) ** 2 + (B[p] - B[q]) ** 2)
  const touch = (a: number, b: number, d: number) => {
    const key = a < b ? a * R + b : b * R + a
    shared.set(key, (shared.get(key) ?? 0) + 1)
    contrast.set(key, (contrast.get(key) ?? 0) + d)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const a = regions[i]
      if (a < 0) continue
      if (x < width - 1 && regions[i + 1] >= 0 && regions[i + 1] !== a)
        touch(a, regions[i + 1], step(x > 0 ? i - 1 : i, x < width - 2 ? i + 2 : i + 1))
      if (y < height - 1 && regions[i + width] >= 0 && regions[i + width] !== a)
        touch(a, regions[i + width], step(y > 0 ? i - width : i, y < height - 2 ? i + 2 * width : i + width))
    }
  }

  const parent = new Int32Array(R)
  for (let r = 0; r < R; r++) parent[r] = r
  const find = (r: number): number => {
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]]
      r = parent[r]
    }
    return r
  }
  const union = (from: number, into: number) => {
    parent[from] = into
    area[into] += area[from]
    sumL[into] += sumL[from]
    sumA[into] += sumA[from]
    sumB[into] += sumB[from]
  }
  const delta = (a: number, b: number) => {
    const dl = sumL[a] / area[a] - sumL[b] / area[b]
    const da = sumA[a] / area[a] - sumA[b] / area[b]
    const db = sumB[a] / area[a] - sumB[b] / area[b]
    return Math.sqrt(dl * dl + da * da + db * db)
  }

  // 3. Merge neighbours that look alike, most alike first, and neighbours with no visible edge
  //    between them: the bands k-means cuts a smooth gradient into.
  const softEdge = settings.mergeDelta * 0.75
  const edges = [...shared.entries()].map(([key, n]) => {
    const a = Math.floor(key / R)
    const b = key - a * R
    return { a, b, d: delta(a, b), soft: contrast.get(key)! / n < softEdge }
  })
  edges.sort((p, q) => p.d - q.d)
  for (const { a, b, soft } of edges) {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb || (!soft && delta(ra, rb) >= settings.mergeDelta)) continue
    if (area[ra] >= area[rb]) union(rb, ra)
    else union(ra, rb)
  }

  // 4. Fold crumbs into the neighbour they share the longest border with.
  const minArea = Math.max(24, settings.minArea * count)
  const adjacent = new Map<number, Map<number, number>>()
  const link = (a: number, b: number, n: number) => {
    let m = adjacent.get(a)
    if (!m) adjacent.set(a, (m = new Map()))
    m.set(b, (m.get(b) ?? 0) + n)
  }
  for (const [key, n] of shared) {
    const a = find(Math.floor(key / R))
    const b = find(key % R)
    if (a === b) continue
    link(a, b, n)
    link(b, a, n)
  }
  const roots = [...adjacent.keys()].sort((p, q) => area[p] - area[q])
  for (const r of roots) {
    if (area[r] >= minArea) continue
    const neighbours = adjacent.get(r)
    if (!neighbours?.size) continue
    let into = -1
    let longest = -1
    for (const [n, len] of neighbours) {
      if (len > longest || (len === longest && delta(r, n) < delta(r, into))) {
        into = n
        longest = len
      }
    }
    union(r, into)
    const target = adjacent.get(into)!
    target.delete(r)
    for (const [n, len] of neighbours) {
      if (n === into) continue
      const back = adjacent.get(n)!
      back.delete(r)
      back.set(into, (back.get(into) ?? 0) + len)
      target.set(n, (target.get(n) ?? 0) + len)
    }
    adjacent.delete(r)
  }

  // 5. Folding crumbs can bring big areas together that only touched through them before (noise
  //    along a soft shading edge); give those pairs the same chance to merge.
  const pairs = new Map<number, { n: number; c: number; a: number; b: number }>()
  for (const [key, n] of shared) {
    const a = find(Math.floor(key / R))
    const b = find(key % R)
    if (a === b) continue
    const k = a < b ? a * R + b : b * R + a
    const pair = pairs.get(k) ?? { n: 0, c: 0, a, b }
    pair.n += n
    pair.c += contrast.get(key)!
    pairs.set(k, pair)
  }
  for (const { n, c, a, b } of [...pairs.values()].sort((p, q) => p.c / p.n - q.c / q.n)) {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb || (c / n >= softEdge && delta(ra, rb) >= settings.mergeDelta)) continue
    if (area[ra] >= area[rb]) union(rb, ra)
    else union(ra, rb)
  }

  for (const i of pixels) regions[i] = find(regions[i])
  return smoothBorders(regions, width, height, 4)
}

/**
 * Evens out wiggly borders between areas (noise in a gradient) with repeated 3×3 majority votes.
 * Each vote rounds corners off a little, like a pebble in a stream.
 */
function smoothBorders(
  regions: Int32Array<ArrayBuffer>,
  width: number,
  height: number,
  passes: number,
): Int32Array<ArrayBuffer> {
  let cur = regions
  const votes = new Int32Array(9)
  const tally = new Int32Array(9)
  for (let pass = 0; pass < passes; pass++) {
    const next = cur.slice()
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const own = cur[i]
        if (own < 0) continue
        if (cur[i - 1] === own && cur[i + 1] === own && cur[i - width] === own && cur[i + width] === own) continue
        let n = 0
        for (let dy = -width; dy <= width; dy += width) {
          for (let dx = -1; dx <= 1; dx++) {
            const l = cur[i + dy + dx]
            if (l < 0) continue
            let k = 0
            while (k < n && votes[k] !== l) k++
            if (k === n) {
              votes[n] = l
              tally[n++] = 0
            }
            tally[k]++
          }
        }
        let best = own
        let bestCount = 0
        for (let k = 0; k < n; k++) {
          if (votes[k] === own && tally[k] >= bestCount) {
            best = own
            bestCount = tally[k]
          } else if (tally[k] > bestCount) {
            best = votes[k]
            bestCount = tally[k]
          }
        }
        next[i] = best
      }
    }
    cur = next
  }
  return cur
}

/**
 * The sticker's white die-cut border, plus any plain white background around the subject that
 * came with the cut-out. Returns the pixels to leave off the page, or null if there are none.
 *
 * Near-white pixels reachable from outside are flooded. In inked artwork the subject's own outline
 * stops the flood, so everything it reached is backing. Without ink a white subject could be
 * flooded too, so only a border-thick band along the edge is taken.
 */
function dieCutBorder(
  lab: { L: Float32Array; A: Float32Array; B: Float32Array; inside: Uint8Array },
  ink: Uint8Array,
  width: number,
  height: number,
): Uint8Array | null {
  const size = width * height
  const { inside, L, A, B } = lab
  const white = (i: number) => L[i] > 88 && A[i] * A[i] + B[i] * B[i] < 100
  const flood = new Uint8Array(size)
  const stack = new Int32Array(size)
  let top = 0
  for (let i = 0; i < size; i++) {
    if (inside[i]) continue
    const x = i % width
    const touch = (j: number) => {
      if (inside[j] && !flood[j] && white(j)) {
        flood[j] = 1
        stack[top++] = j
      }
    }
    if (x > 0) touch(i - 1)
    if (x < width - 1) touch(i + 1)
    if (i >= width) touch(i - width)
    if (i < size - width) touch(i + width)
  }
  // Pixels at the picture's edge count as outside too.
  for (let x = 0; x < width; x++) {
    for (const i of [x, size - width + x]) if (inside[i] && !flood[i] && white(i)) (flood[i] = 1), (stack[top++] = i)
  }
  for (let y = 0; y < height; y++) {
    for (const i of [y * width, y * width + width - 1]) if (inside[i] && !flood[i] && white(i)) (flood[i] = 1), (stack[top++] = i)
  }
  let flooded = 0
  while (top > 0) {
    const i = stack[--top]
    flooded++
    const x = i % width
    const visit = (j: number) => {
      if (inside[j] && !flood[j] && white(j)) {
        flood[j] = 1
        stack[top++] = j
      }
    }
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < size - width) visit(i + width)
  }
  if (!flooded) return null

  // Where the flood stopped: on ink (an outlined drawing) or on colour?
  const nearInk = dilate(ink, width, height, Math.max(2, Math.max(width, height) / 400))
  let stops = 0
  let inked = 0
  for (let i = width; i < size - width; i++) {
    if (!flood[i]) continue
    const x = i % width
    if (x === 0 || x === width - 1) continue
    for (const j of [i - 1, i + 1, i - width, i + width]) {
      // Pale tints (halos of light lines, JPEG fringes) say nothing either way.
      if (inside[j] && !flood[j] && (nearInk[j] || L[j] < 80)) {
        stops++
        if (nearInk[j]) inked++
        break
      }
    }
  }
  if (stops && inked / stops > 0.6) {
    // The drawing is outlined, so pale tints the flood stopped at outside the outlines (halos
    // around light strokes, JPEG fringes) are backing too. The strokes themselves are ink.
    for (let i = 0; i < size; i++) if (flood[i]) stack[top++] = i
    while (top > 0) {
      const i = stack[--top]
      const x = i % width
      const visit = (j: number) => {
        if (inside[j] && !flood[j] && !ink[j] && L[j] > 75) {
          flood[j] = 1
          stack[top++] = j
        }
      }
      if (x > 0) visit(i - 1)
      if (x < width - 1) visit(i + 1)
      if (i >= width) visit(i - width)
      if (i < size - width) visit(i + width)
    }
    return flood
  }

  const outside = new Uint8Array(size)
  for (let i = 0; i < size; i++) outside[i] = inside[i] ? 0 : 1
  const fromOutside = distanceTransform(outside, width, height)
  // Borders are at most 4.5% of the sticker's size (see OUTLINE_RATIO in sticker.ts).
  const maxDepth = (0.055 * Math.max(width, height) + 2) ** 2
  for (let i = 0; i < size; i++) if (flood[i] && fromOutside[i] > maxDepth) flood[i] = 0
  return flood
}

/**
 * Colour areas don't gain anything from enlarging (only their borders would get smoother), so
 * they're found on the original pixels, then enlarged and their borders evened out.
 */
function segmentAtSource(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  usable: Uint8Array,
  width: number,
  height: number,
  settings: DetailSettings,
): Int32Array {
  const lab = toLab(source, sourceWidth, sourceHeight)
  const pick = (x: number, y: number) =>
    Math.min(height - 1, Math.floor(((y + 0.5) * height) / sourceHeight)) * width +
    Math.min(width - 1, Math.floor(((x + 0.5) * width) / sourceWidth))
  const usableHere = new Uint8Array(sourceWidth * sourceHeight)
  for (let y = 0; y < sourceHeight; y++) for (let x = 0; x < sourceWidth; x++) usableHere[y * sourceWidth + x] = usable[pick(x, y)]
  const small = segment(lab, usableHere, sourceWidth, sourceHeight, settings)
  const regions = new Int32Array(width * height).fill(-1)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sourceHeight - 1, Math.floor(((y + 0.5) * sourceHeight) / height))
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!usable[i]) continue
      const sx = Math.min(sourceWidth - 1, Math.floor(((x + 0.5) * sourceWidth) / width))
      regions[i] = small[sy * sourceWidth + sx]
    }
  }
  // Areas cut off by the finer ink mask still need a label: borrow a neighbour's.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < regions.length; i++) {
      if (!usable[i] || regions[i] >= 0) continue
      const x = i % width
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j >= 0 && j < regions.length && regions[j] >= 0) {
          regions[i] = regions[j]
          break
        }
      }
    }
  }
  return smoothBorders(regions, width, height, Math.round(height / sourceHeight) + 2)
}

/** Finds the lines of a coloring page for an RGBA sticker. */
export function traceLines(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  detail: ColoringDetail,
): LineFields {
  const settings = SETTINGS[detail]
  const upscale = Math.min(MAX_UPSCALE, Math.max(1, WORK_SIZE / Math.max(sourceWidth, sourceHeight)))
  const width = Math.round(sourceWidth * upscale)
  const height = Math.round(sourceHeight * upscale)
  const rgba = upscale > 1 ? resizeBicubic(source, sourceWidth, sourceHeight, width, height) : source
  const size = width * height
  const scale = Math.max(width, height)

  const lab = toLab(rgba, width, height)
  const inside = lab.inside.slice()
  const chroma = new Float32Array(size)
  for (let i = 0; i < size; i++) chroma[i] = Math.hypot(lab.A[i], lab.B[i])
  const ink = findInk(lab.L, inside, chroma, width, height, settings.inkContrast)

  // The page shows the picture, not the sticker's white backing.
  const border = dieCutBorder(lab, ink, width, height)
  let area = 0
  for (let i = 0; i < size; i++) {
    if (border?.[i]) inside[i] = 0
    if (!inside[i]) ink[i] = 0
    area += inside[i]
  }
  hollowSolids(ink, width, height, scale / 260, scale / 50, area * 0.012)

  // Keep a little clear of ink, where colours are still blended with the stroke.
  const nearInk = dilate(ink, width, height, Math.max(1, scale / 700))
  const usable = new Uint8Array(size)
  for (let i = 0; i < size; i++) usable[i] = inside[i] && !nearInk[i] ? 1 : 0
  const regions = upscale > 1 ? segmentAtSource(source, sourceWidth, sourceHeight, usable, width, height, settings) : segment(lab, usable, width, height, settings)

  const borders = new Uint8Array(size)
  const edge = new Uint8Array(size)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!inside[i]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        edge[i] = 1
        continue
      }
      if (!inside[i - 1] || !inside[i + 1] || !inside[i - width] || !inside[i + width]) edge[i] = 1
      const r = regions[i]
      if (r < 0) continue
      const right = regions[i + 1]
      const down = regions[i + width]
      if ((right >= 0 && right !== r) || (down >= 0 && down !== r)) borders[i] = 1
    }
  }

  // Where the artwork has its own line, don't draw a second one next to it: no silhouette along an
  // inked edge, and no colour borders hugging ink. Stubs left over are noise.
  const inkFar = distanceTransform(ink, width, height)
  const besideInk = (scale / 200) ** 2
  for (let i = 0; i < size; i++) {
    if (edge[i] && inkFar[i] <= besideInk) edge[i] = 0
    if (borders[i] && inkFar[i] <= (scale / 250) ** 2) borders[i] = 0
  }
  dropSmallComponents(borders, width, height, Math.round(scale / 40))
  dropSmallComponents(edge, width, height, Math.round(scale / 60))

  // Distances are slightly blurred, which rounds off the pixel staircase along every line.
  const soften = Math.max(0.8, upscale * 0.45)
  const field = (seeds: Uint8Array) => {
    const d2 = distanceTransform(seeds, width, height)
    const out = new Float32Array(size)
    for (let i = 0; i < size; i++) out[i] = Math.sqrt(d2[i])
    const soft = gaussianBlur(out, width, height, soften)
    // Blurring lifts the zero along a line by about σ·√(2/π); put it back.
    const lift = soften * 0.8
    for (let i = 0; i < size; i++) soft[i] = Math.max(0, soft[i] - lift)
    return soft
  }
  // Ink is drawn at its own width, so it gets a signed distance to the stroke's edge: negative
  // inside the stroke, positive outside.
  const toInk = distanceTransform(ink, width, height)
  const paper = new Uint8Array(size)
  for (let i = 0; i < size; i++) paper[i] = ink[i] ? 0 : 1
  const toPaper = distanceTransform(paper, width, height)
  const inkEdge = new Float32Array(size)
  for (let i = 0; i < size; i++) inkEdge[i] = ink[i] ? 0.5 - Math.sqrt(toPaper[i]) : Math.sqrt(toInk[i]) - 0.5
  const bounds =
    maxX < 0
      ? { x: 0, y: 0, width, height }
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  return {
    width,
    height,
    regions: field(borders),
    ink: gaussianBlur(inkEdge, width, height, soften),
    outline: field(edge),
    bounds,
  }
}

/** Line widths in output pixels. */
export interface LineStyle {
  line: number
  outline: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The part of the sticker the drawing covers, in source pixels, with `pad` px to spare. It can be
 * smaller than the sticker, since the white die-cut border is left off.
 */
export function lineBounds(fields: LineFields, pad: number): Rect {
  const { width, height, bounds } = fields
  const x = Math.max(0, Math.floor(bounds.x - pad))
  const y = Math.max(0, Math.floor(bounds.y - pad))
  return {
    x,
    y,
    width: Math.min(width, Math.ceil(bounds.x + bounds.width + pad)) - x,
    height: Math.min(height, Math.ceil(bounds.y + bounds.height + pad)) - y,
  }
}

/**
 * Draws the lines inside `rect` (default: everything) at `outWidth` × `outHeight` as black on
 * transparent, anti-aliased. Distances are
 * interpolated between source pixels, so curves stay smooth when the page is bigger than the sticker.
 */
export function renderLines(
  fields: LineFields,
  outWidth: number,
  outHeight: number,
  style: LineStyle,
  rect: Rect = { x: 0, y: 0, width: fields.width, height: fields.height },
) {
  const { width, height } = fields
  const out = new Uint8ClampedArray(outWidth * outHeight * 4)
  const scale = outWidth / rect.width
  const lineHalf = style.line / 2
  const outlineHalf = style.outline / 2
  // Ink keeps the artist's own weight, thickened a little so hairlines still print.
  const inkGrow = lineHalf * 0.25

  const xs = new Int32Array(outWidth)
  const fxs = new Float32Array(outWidth)
  for (let ox = 0; ox < outWidth; ox++) {
    const x = Math.min(width - 1, Math.max(0, rect.x + ((ox + 0.5) * rect.width) / outWidth - 0.5))
    xs[ox] = Math.min(width - 2, Math.floor(x))
    fxs[ox] = x - xs[ox]
  }
  const sample = (f: Float32Array, i: number, fx: number, fy: number) =>
    (f[i] * (1 - fx) + f[i + 1] * fx) * (1 - fy) + (f[i + width] * (1 - fx) + f[i + width + 1] * fx) * fy

  if (width < 2 || height < 2) return out
  for (let oy = 0; oy < outHeight; oy++) {
    const y = Math.min(height - 1, Math.max(0, rect.y + ((oy + 0.5) * rect.height) / outHeight - 0.5))
    const y0 = Math.min(height - 2, Math.floor(y))
    const fy = y - y0
    for (let ox = 0; ox < outWidth; ox++) {
      const i = y0 * width + xs[ox]
      const fx = fxs[ox]
      const cover = Math.max(
        lineHalf + 0.5 - sample(fields.regions, i, fx, fy) * scale,
        inkGrow + 0.5 - sample(fields.ink, i, fx, fy) * scale,
        outlineHalf + 0.5 - sample(fields.outline, i, fx, fy) * scale,
      )
      if (cover <= 0) continue
      out[(oy * outWidth + ox) * 4 + 3] = cover >= 1 ? 255 : Math.round(cover * 255)
    }
  }
  return out
}
