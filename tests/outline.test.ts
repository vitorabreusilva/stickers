import { describe, expect, it } from 'vitest'
import { addOutline, distanceTransform, opaqueBounds } from '../src/lib/outline'

function bruteForce(mask: Uint8Array, w: number, h: number) {
  const out = new Float64Array(w * h)
  for (let i = 0; i < w * h; i++) {
    let best = Infinity
    for (let j = 0; j < w * h; j++) {
      if (!mask[j]) continue
      const dx = (i % w) - (j % w)
      const dy = Math.floor(i / w) - Math.floor(j / w)
      best = Math.min(best, dx * dx + dy * dy)
    }
    out[i] = best
  }
  return out
}

/** An RGBA image with an opaque red rect, everything else transparent. */
function redRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) data.set([255, 0, 0, 255], (y * w + x) * 4)
  }
  return data
}

const alphaAt = (data: Uint8ClampedArray, w: number, x: number, y: number) => data[(y * w + x) * 4 + 3]
const rgbAt = (data: Uint8ClampedArray, w: number, x: number, y: number) =>
  Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 3))

describe('distanceTransform', () => {
  it('matches brute force on random masks', () => {
    let seed = 42
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let trial = 0; trial < 5; trial++) {
      const w = 17
      const h = 11
      const mask = new Uint8Array(w * h).map(() => (rand() < 0.08 ? 1 : 0))
      mask[trial] = 1
      expect(Array.from(distanceTransform(mask, w, h))).toEqual(Array.from(bruteForce(mask, w, h)))
    }
  })
})

describe('addOutline', () => {
  it('adds a white border of the requested width around opaque pixels', () => {
    const w = 40
    const h = 40
    const out = addOutline(redRect(w, h, 15, 15, 25, 25), w, h, 5)

    expect(rgbAt(out, w, 20, 20)).toEqual([255, 0, 0])
    expect(alphaAt(out, w, 20, 20)).toBe(255)
    // Inside the border: opaque white.
    expect(rgbAt(out, w, 12, 20)).toEqual([255, 255, 255])
    expect(alphaAt(out, w, 12, 20)).toBe(255)
    expect(alphaAt(out, w, 11, 20)).toBe(255)
    // The outermost pixel is anti-aliased.
    expect(alphaAt(out, w, 10, 20)).toBe(128)
    // Past the border: untouched.
    expect(alphaAt(out, w, 9, 20)).toBe(0)
    // Corners are rounded, not square.
    expect(alphaAt(out, w, 10, 10)).toBe(0)
  })

  it('keeps big enclosed gaps open, like the space between legs', () => {
    const w = 80
    const h = 80
    const data = redRect(w, h, 10, 10, 70, 70)
    // A 30x30 transparent gap fully enclosed by the subject.
    for (let y = 25; y < 55; y++) for (let x = 25; x < 55; x++) data[(y * w + x) * 4 + 3] = 0
    const out = addOutline(data, w, h, 3)
    expect(alphaAt(out, w, 40, 40)).toBe(0)
    // The border still runs around the gap's edge.
    expect(rgbAt(out, w, 26, 40)).toEqual([255, 255, 255])
    expect(alphaAt(out, w, 26, 40)).toBe(255)
  })

  it('fills enclosed gaps too small to cut out', () => {
    const w = 60
    const h = 60
    const data = redRect(w, h, 10, 10, 50, 50)
    // A 10x10 gap: after a 3px border on each side only a sliver is left.
    for (let y = 25; y < 35; y++) for (let x = 25; x < 35; x++) data[(y * w + x) * 4 + 3] = 0
    const out = addOutline(data, w, h, 3)
    expect(alphaAt(out, w, 30, 30)).toBe(255)
    expect(rgbAt(out, w, 30, 30)).toEqual([255, 255, 255])
  })

  it('returns a copy when there is no border', () => {
    const data = redRect(8, 8, 2, 2, 6, 6)
    const out = addOutline(data, 8, 8, 0)
    expect(out).toEqual(data)
    expect(out).not.toBe(data)
  })
})

describe('opaqueBounds', () => {
  it('finds the visible area', () => {
    expect(opaqueBounds(redRect(20, 10, 3, 2, 9, 7), 20, 10)).toEqual({ x: 3, y: 2, width: 6, height: 5 })
    expect(opaqueBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4)).toBeNull()
  })
})
