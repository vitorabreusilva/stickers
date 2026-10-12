import { describe, expect, it } from 'vitest'
import { keepMainBlobs, refineMask } from '../src/lib/mask'

/** A confidence mask with filled rects of the given value. */
function maskWith(width: number, height: number, rects: [number, number, number, number, number][]) {
  const m = new Float32Array(width * height)
  for (const [x0, y0, x1, y1, v] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * width + x] = v
  }
  return m
}

describe('refineMask', () => {
  it('keeps the subject and drops small specks', () => {
    const conf = maskWith(100, 100, [
      [20, 20, 70, 70, 0.95], // subject
      [90, 90, 92, 92, 0.9], // speck
    ])
    const refined = refineMask(conf, 100, 100)!
    expect(refined.bounds).toEqual({ x: 20, y: 20, width: 50, height: 50 })
    expect(refined.alpha[45 * 100 + 45]).toBeGreaterThan(0.95)
    expect(refined.alpha[91 * 100 + 91]).toBe(0)
    expect(refined.coverage).toBeCloseTo((50 * 50 + 2 * 2) / (100 * 100))
  })

  it('keeps a second blob that is a real part of the subject', () => {
    const conf = maskWith(100, 100, [
      [10, 10, 50, 50, 0.9],
      [60, 10, 90, 40, 0.9],
    ])
    expect(refineMask(conf, 100, 100)!.bounds).toEqual({ x: 10, y: 10, width: 80, height: 40 })
  })

  it('keeps soft edges next to the subject but removes faint haze elsewhere', () => {
    const conf = maskWith(100, 100, [
      [0, 0, 100, 100, 0.4], // haze everywhere
      [30, 30, 60, 60, 0.9],
    ])
    const refined = refineMask(conf, 100, 100)!
    // One pixel outside the subject: soft edge.
    expect(refined.alpha[45 * 100 + 29]).toBeGreaterThan(0)
    expect(refined.alpha[45 * 100 + 29]).toBeLessThan(0.5)
    // Far away: gone.
    expect(refined.alpha[5 * 100 + 5]).toBe(0)
    expect(refined.bounds).toEqual({ x: 28, y: 28, width: 34, height: 34 })
  })

  it('returns null when nothing was found', () => {
    expect(refineMask(new Float32Array(100 * 100), 100, 100)).toBeNull()
    expect(refineMask(maskWith(100, 100, [[0, 0, 100, 100, 0.2]]), 100, 100)).toBeNull()
  })
})

describe('keepMainBlobs', () => {
  it('drops a floating watermark under the subject', () => {
    const w = 100
    const h = 100
    const alpha = new Float32Array(w * h)
    for (let y = 10; y < 70; y++) for (let x = 20; x < 80; x++) alpha[y * w + x] = 1
    for (let x = 30; x < 70; x++) alpha[90 * w + x] = 1 // thin line well below
    expect(keepMainBlobs(alpha, w, h)).toBe(true)
    expect(alpha[90 * w + 50]).toBe(0)
    expect(alpha[40 * w + 50]).toBe(1)
  })
})
