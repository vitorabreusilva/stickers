// Exact cut-outs for pictures on a plain backdrop (clip art on a white page, product shots on a
// studio wall, a gentle gradient): the picture itself says where the subject ends, so edges are
// un-blended against the known backdrop instead of guessed by a model. Pure functions, no DOM.

import { boxMean } from './refine'

/** Smooth backdrop colour: a quadratic in x and y per channel. */
export interface Backdrop {
  /** 3 channels × 6 coefficients (1, x, y, x², xy, y²) over coordinates normalised to -0.5..0.5. */
  coef: Float64Array
  /** Typical colour deviation of backdrop pixels from the fit (RGB units). */
  noise: number
}

const TERMS = 6

function basis(x: number, y: number, width: number, height: number, out: Float64Array) {
  const u = x / width - 0.5
  const v = y / height - 0.5
  out[0] = 1
  out[1] = u
  out[2] = v
  out[3] = u * u
  out[4] = u * v
  out[5] = v * v
}

/** Solves the symmetric positive system A·x = b in place (Gaussian elimination with pivoting). */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r * n + col]) > Math.abs(A[pivot * n + col])) pivot = r
    if (Math.abs(A[pivot * n + col]) < 1e-12) return null
    if (pivot !== col) {
      for (let k = 0; k < n; k++) [A[col * n + k], A[pivot * n + k]] = [A[pivot * n + k], A[col * n + k]]
      ;[b[col], b[pivot]] = [b[pivot], b[col]]
    }
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / A[col * n + col]
      for (let k = col; k < n; k++) A[r * n + k] -= f * A[col * n + k]
      b[r] -= f * b[col]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k]
    x[r] = s / A[r * n + r]
  }
  return x
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1] ?? 0
}

// A backdrop is "plain" when almost all sampled pixels sit close to a smooth fit.
const MIN_FIT = 0.8
const MAX_NOISE = 12
const MAX_SAMPLES = 40000

/**
 * Fits a smooth backdrop to the pixels marked in `samples` (the picture around the user's loop).
 * Returns null if they don't look like a plain backdrop (a busy photo, several surfaces).
 */
export function fitBackdrop(rgba: Uint8ClampedArray, width: number, height: number, samples: Uint8Array): Backdrop | null {
  const picked: number[] = []
  for (let i = 0; i < samples.length; i++) if (samples[i] && rgba[i * 4 + 3] === 255) picked.push(i)
  if (picked.length < 200) return null
  const step = Math.max(1, Math.floor(picked.length / MAX_SAMPLES))
  const idx = picked.filter((_, k) => k % step === 0)

  const n = idx.length
  const rows = new Float64Array(n * TERMS)
  const tmp = new Float64Array(TERMS)
  for (let k = 0; k < n; k++) {
    basis(idx[k] % width, Math.floor(idx[k] / width), width, height, tmp)
    rows.set(tmp, k * TERMS)
  }
  let keep = new Uint8Array(n).fill(1)
  let coef = new Float64Array(3 * TERMS)
  const residual = new Float64Array(n)

  for (let iteration = 0; iteration < 4; iteration++) {
    for (let c = 0; c < 3; c++) {
      const A = new Float64Array(TERMS * TERMS)
      const b = new Float64Array(TERMS)
      for (let k = 0; k < n; k++) {
        if (!keep[k]) continue
        const value = rgba[idx[k] * 4 + c]
        for (let i = 0; i < TERMS; i++) {
          const ri = rows[k * TERMS + i]
          b[i] += ri * value
          for (let j = 0; j < TERMS; j++) A[i * TERMS + j] += ri * rows[k * TERMS + j]
        }
      }
      // A little ridge keeps the fit stable when samples only cover part of the picture.
      for (let i = 1; i < TERMS; i++) A[i * TERMS + i] += 1e-3 * n
      const x = solve(A, b, TERMS)
      if (!x) return null
      coef.set(x, c * TERMS)
    }
    const kept: number[] = []
    for (let k = 0; k < n; k++) {
      let s = 0
      for (let c = 0; c < 3; c++) {
        let fit = 0
        for (let i = 0; i < TERMS; i++) fit += coef[c * TERMS + i] * rows[k * TERMS + i]
        const d = rgba[idx[k] * 4 + c] - fit
        s += d * d
      }
      residual[k] = Math.sqrt(s)
      if (keep[k]) kept.push(residual[k])
    }
    const med = median(kept)
    const mad = median(kept.map((r) => Math.abs(r - med))) + 1e-6
    const limit = Math.max(med + 4 * 1.4826 * mad, 6)
    keep = Uint8Array.from(residual, (r) => (r < limit ? 1 : 0))
  }

  let inliers = 0
  const kept: number[] = []
  for (let k = 0; k < n; k++) {
    if (!keep[k]) continue
    inliers++
    kept.push(residual[k])
  }
  const noise = median(kept) * 1.4826 + 1
  if (inliers / n < MIN_FIT || noise > MAX_NOISE) return null
  coef = Float64Array.from(coef)
  return { coef, noise }
}

/** The fitted backdrop colour at every pixel, as RGB triplets. */
export function backdropColors(backdrop: Backdrop, width: number, height: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(width * height * 3)
  const tmp = new Float64Array(TERMS)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      basis(x, y, width, height, tmp)
      const o = (y * width + x) * 3
      for (let c = 0; c < 3; c++) {
        let v = 0
        for (let i = 0; i < TERMS; i++) v += backdrop.coef[c * TERMS + i] * tmp[i]
        out[o + c] = v
      }
    }
  }
  return out
}

/** Connected regions of `on` pixels (4- or 8-connected). Label 0 is "off". */
export function labelRegions(on: Uint8Array, width: number, height: number, eight = false) {
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
    while (top > 0) {
      const i = stack[--top]
      area++
      const x = i % width
      const y = (i - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const j = ny * width + nx
          if (on[j] && !labels[j]) {
            labels[j] = label
            stack[top++] = j
          }
        }
      }
    }
    areas.push(area)
  }
  return { labels, areas }
}

export interface BackdropMatte {
  /** Opacity 0..1 per pixel. */
  alpha: Float32Array<ArrayBuffer>
  /** Subject colour with the backdrop un-blended out of the edges, RGBA. */
  rgba: Uint8ClampedArray<ArrayBuffer>
}

// Enclosed backdrop-coloured areas smaller than this (pixels, or share of the picture) are specks
// where an outline blends into a fill, or JPEG noise, never holes.
const MIN_HOLE = 64
const MIN_HOLE_SHARE = 0.0004
// An area this colourful (max - min channel) isn't white or grey.
const MIN_CHROMA = 12

/**
 * Cuts the subject out of a picture on a plain backdrop. `inside` marks the user's loop. Returns
 * null if the backdrop isn't plain. No model needed: the picture says where the subject ends.
 */
export function matteOnBackdrop(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  inside: Uint8Array,
): BackdropMatte | null {
  const size = width * height
  // Backdrop samples: everything outside the loop, plus a thin frame around the picture.
  const samples = new Uint8Array(size)
  const frame = 3
  for (let i = 0; i < size; i++) {
    const x = i % width
    const y = (i - x) / width
    if (!inside[i] || x < frame || y < frame || x >= width - frame || y >= height - frame) samples[i] = 1
  }
  const backdrop = fitBackdrop(rgba, width, height, samples)
  if (!backdrop) return null
  const field = backdropColors(backdrop, width, height)

  const dist = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    const dr = rgba[i * 4] - field[i * 3]
    const dg = rgba[i * 4 + 1] - field[i * 3 + 1]
    const db = rgba[i * 4 + 2] - field[i * 3 + 2]
    dist[i] = Math.sqrt(dr * dr + dg * dg + db * db)
  }
  const tBg = Math.max(12, 4 * backdrop.noise)

  // Backdrop reachable from the outside: everything backdrop-coloured connected to the samples.
  const background = new Uint8Array(size)
  const stack = new Int32Array(size)
  let top = 0
  for (let i = 0; i < size; i++) {
    if (samples[i] && dist[i] < tBg) {
      background[i] = 1
      stack[top++] = i
    }
  }
  const visit = (j: number) => {
    if (!background[j] && dist[j] < tBg) {
      background[j] = 1
      stack[top++] = j
    }
  }
  while (top > 0) {
    const i = stack[--top]
    const x = i % width
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < size - width) visit(i + width)
  }

  // Backdrop-coloured areas enclosed by the subject. White or grey ones are usually part of it
  // (eye whites, highlights, a ghost's body); one matching a coloured backdrop is a hole (the
  // inside of a bag handle on a pink page).
  const enclosed = new Uint8Array(size)
  for (let i = 0; i < size; i++) enclosed[i] = !background[i] && dist[i] < tBg ? 1 : 0
  const holes = labelRegions(enclosed, width, height)
  if (holes.areas.length > 1) {
    const r = new Float64Array(holes.areas.length)
    const g = new Float64Array(holes.areas.length)
    const b = new Float64Array(holes.areas.length)
    for (let i = 0; i < size; i++) {
      const l = holes.labels[i]
      if (!l) continue
      r[l] += rgba[i * 4]
      g[l] += rgba[i * 4 + 1]
      b[l] += rgba[i * 4 + 2]
    }
    const minArea = Math.max(MIN_HOLE, MIN_HOLE_SHARE * size)
    const isHole = holes.areas.map((area, l) => {
      if (!l || area < minArea) return false
      const mr = r[l] / area
      const mg = g[l] / area
      const mb = b[l] / area
      return Math.max(mr, mg, mb) - Math.min(mr, mg, mb) >= MIN_CHROMA
    })
    for (let i = 0; i < size; i++) if (isHole[holes.labels[i]]) background[i] = 1
  }

  const fg = new Uint8Array(size)
  for (let i = 0; i < size; i++) fg[i] = background[i] ? 0 : 1
  keepSubjectPieces(fg, width, height, inside)
  return unblend(rgba, width, height, fg, dist, field, tBg)
}

/**
 * Keeps the separate pieces that make up the subject: those mostly inside the loop, minus small
 * thin scraps (watermarks, ground lines). Small solid pieces well inside the loop stay (a cherry on
 * top, a sparkle next to a character).
 */
export function keepSubjectPieces(fg: Uint8Array, width: number, height: number, inside: Uint8Array) {
  const size = width * height
  const { labels, areas } = labelRegions(fg, width, height, true)
  const n = areas.length
  if (n <= 1) return
  const insideCount = new Float64Array(n)
  const perimeter = new Float64Array(n)
  for (let i = 0; i < size; i++) {
    const l = labels[i]
    if (!l) continue
    if (inside[i]) insideCount[l]++
    const x = i % width
    const onEdge =
      x === 0 || x === width - 1 || i < width || i >= size - width ||
      !fg[i - 1] || !fg[i + 1] || !fg[i - width] || !fg[i + width]
    if (onEdge) perimeter[l]++
  }
  let biggest = 0
  for (let l = 1; l < n; l++) biggest = Math.max(biggest, areas[l])
  const minThickness = Math.max(3, 0.006 * Math.max(width, height))
  const keep = areas.map((area, l) => {
    if (!l) return false
    const insideShare = insideCount[l] / area
    if (insideShare <= 0.5) return false
    if (area >= 0.25 * biggest) return true
    const thickness = (2 * area) / Math.max(1, perimeter[l])
    return thickness >= minThickness && area >= 0.0005 * biggest && insideShare > 0.8
  })
  for (let i = 0; i < size; i++) if (labels[i] && !keep[labels[i]]) fg[i] = 0
}

/**
 * Opacity 1 inside the subject, 0 in the backdrop, and exact along the edge: each edge pixel is
 * un-blended as a mix of the nearby solid subject colour and the known backdrop colour.
 */
function unblend(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  fg: Uint8Array,
  dist: Float32Array,
  field: Float32Array,
  tBg: number,
): BackdropMatte {
  const size = width * height
  // Edge pixels: subject pixels within 2px of the backdrop.
  const near = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    if (fg[i]) continue
    const x = i % width
    const y = (i - x) / width
    for (let dy = -2; dy <= 2; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx
        if (nx >= 0 && nx < width && fg[ny * width + nx]) near[ny * width + nx] = 1
      }
    }
  }

  // Local solid subject colour, from subject pixels clearly unlike the backdrop. The purest (furthest
  // from the backdrop) count most, so a thin stroke uses its own core colour.
  const solidR = new Float32Array(size)
  const solidG = new Float32Array(size)
  const solidB = new Float32Array(size)
  const solidN = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    if (!fg[i] || dist[i] < tBg * 2) continue
    const w = dist[i] * dist[i]
    solidR[i] = rgba[i * 4] * w
    solidG[i] = rgba[i * 4 + 1] * w
    solidB[i] = rgba[i * 4 + 2] * w
    solidN[i] = w
  }
  let radius = 2
  let mR = boxMean(solidR, width, height, radius)
  let mG = boxMean(solidG, width, height, radius)
  let mB = boxMean(solidB, width, height, radius)
  let mN = boxMean(solidN, width, height, radius)
  for (let pass = 0; pass < 3; pass++) {
    let missing = false
    for (let i = 0; i < size && !missing; i++) if (near[i] && mN[i] < 1e-4) missing = true
    if (!missing) break
    radius *= 2
    mR = boxMean(solidR, width, height, radius)
    mG = boxMean(solidG, width, height, radius)
    mB = boxMean(solidB, width, height, radius)
    mN = boxMean(solidN, width, height, radius)
  }

  const alpha = new Float32Array(size)
  const out = new Uint8ClampedArray(rgba.length)
  const minContrast2 = (3 * tBg) ** 2
  for (let i = 0; i < size; i++) {
    const j = i * 4
    if (!fg[i]) continue
    let a = 1
    if (near[i] && mN[i] > 1e-4) {
      const fr = mR[i] / mN[i]
      const fgc = mG[i] / mN[i]
      const fb = mB[i] / mN[i]
      const br = field[i * 3]
      const bg = field[i * 3 + 1]
      const bb = field[i * 3 + 2]
      const dr = fr - br
      const dg = fgc - bg
      const db = fb - bb
      const contrast2 = dr * dr + dg * dg + db * db
      if (contrast2 > minContrast2) {
        a = ((rgba[j] - br) * dr + (rgba[j + 1] - bg) * dg + (rgba[j + 2] - bb) * db) / contrast2
        a = a < 0 ? 0 : a > 1 ? 1 : a
      }
    }
    alpha[i] = a
    if (a <= 0) continue
    // Colour with the backdrop removed: C = a·F + (1 - a)·B  →  F = (C - (1 - a)·B) / a.
    const f = (c: number) => (rgba[j + c] - (1 - a) * field[i * 3 + c]) / a
    out[j] = f(0)
    out[j + 1] = f(1)
    out[j + 2] = f(2)
    out[j + 3] = Math.round(a * rgba[j + 3])
  }
  return { alpha, rgba: out }
}
