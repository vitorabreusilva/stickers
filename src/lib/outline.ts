// Pure pixel operations for turning a cut-out into a die-cut sticker. No DOM access, so they run in tests.

import type { Rect } from './geometry'

const INF = 1e20

/** 1D squared-distance transform of a sampled function (Felzenszwalb & Huttenlocher, 2012). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}

/** Squared Euclidean distance from every pixel to the nearest pixel where `mask` is non-zero. */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float64Array {
  const grid = new Float64Array(width * height)
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] ? 0 : INF

  const n = Math.max(width, height)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]
    edt1d(f, height, d, v, z)
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]
  }
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) f[x] = grid[row + x]
    edt1d(f, width, d, v, z)
    for (let x = 0; x < width; x++) grid[row + x] = d[x]
  }
  return grid
}

/** Sets coverage to 1 for every pixel that isn't reachable from the image edge through partially-covered pixels. */
function fillEnclosed(cover: Float32Array, width: number, height: number) {
  const size = width * height
  const outside = new Uint8Array(size)
  const stack = new Int32Array(size)
  let top = 0
  const visit = (i: number) => {
    if (!outside[i] && cover[i] < 1) {
      outside[i] = 1
      stack[top++] = i
    }
  }
  for (let x = 0; x < width; x++) {
    visit(x)
    visit((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    visit(y * width)
    visit(y * width + width - 1)
  }
  while (top > 0) {
    const i = stack[--top]
    const x = i % width
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < size - width) visit(i + width)
  }
  for (let i = 0; i < size; i++) if (!outside[i]) cover[i] = 1
}

/**
 * Lays the RGBA image over a white die-cut backing that extends `radius` px past its opaque pixels,
 * with enclosed gaps filled in like a real sticker. Leave enough transparent padding for the border.
 */
export function addOutline(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray<ArrayBuffer> {
  const size = width * height
  const out = new Uint8ClampedArray(src.length)
  if (radius <= 0) {
    out.set(src)
    return out
  }

  const mask = new Uint8Array(size)
  for (let i = 0; i < size; i++) mask[i] = src[i * 4 + 3] >= 128 ? 1 : 0
  const dist2 = distanceTransform(mask, width, height)

  // Coverage of the white backing, anti-aliased over one pixel at the outer edge.
  const cover = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    const a = radius + 0.5 - Math.sqrt(dist2[i])
    cover[i] = a <= 0 ? 0 : a >= 1 ? 1 : a
  }
  fillEnclosed(cover, width, height)

  for (let i = 0; i < size; i++) {
    const j = i * 4
    const sa = src[j + 3] / 255
    const wa = cover[i] * (1 - sa)
    const oa = sa + wa
    if (oa <= 0) continue
    out[j] = (src[j] * sa + 255 * wa) / oa
    out[j + 1] = (src[j + 1] * sa + 255 * wa) / oa
    out[j + 2] = (src[j + 2] * sa + 255 * wa) / oa
    out[j + 3] = oa * 255
  }
  return out
}

/** Tight bounds of all pixels with any opacity, or null if the image is fully transparent. */
export function opaqueBounds(data: Uint8ClampedArray, width: number, height: number): Rect | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (data[(row + x) * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}
