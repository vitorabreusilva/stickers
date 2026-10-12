import { describe, expect, it } from 'vitest'
import { boxMean, colorMatte, decontaminate, flatBackdrop, keyOutBackdrop } from '../src/lib/refine'

/** An RGBA image filled with one colour. */
function solid(w: number, h: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4)
  return data
}

function paint(data: Uint8ClampedArray, w: number, rect: [number, number, number, number], rgb: [number, number, number]) {
  const [x0, y0, x1, y1] = rect
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set([...rgb, 255], (y * w + x) * 4)
}

describe('boxMean', () => {
  it('matches a brute-force windowed mean, including at the edges', () => {
    const w = 9
    const h = 7
    const src = Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 11)
    const r = 2
    const out = boxMean(src, w, h, r)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        let n = 0
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
            sum += src[yy * w + xx]
            n++
          }
        expect(out[y * w + x]).toBeCloseTo(sum / n, 4)
      }
    }
  })
})

describe('colorMatte', () => {
  const w = 64
  const h = 32
  // The model's guess: a soft ramp centred 5px right of the real edge at x = 32.
  const ramp = () => {
    const mask = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = Math.min(1, Math.max(0, (45 - x) / 16))
    return mask
  }

  it('snaps a blurry mask edge onto a sharp edge in the picture', () => {
    const rgba = solid(w, h, [40, 90, 220])
    paint(rgba, w, [0, 0, 32, h], [240, 150, 60])
    const alpha = colorMatte(rgba, ramp(), w, h, 10)
    const row = 16 * w
    expect(alpha[row + 31]).toBeCloseTo(1, 5)
    expect(alpha[row + 32]).toBeCloseTo(0, 5)
    expect(alpha[row + 40]).toBeCloseTo(0, 5)
  })

  it('keeps the model mask where subject and background look the same', () => {
    const rgba = solid(w, h, [120, 120, 120])
    const mask = ramp()
    const alpha = colorMatte(rgba, mask, w, h, 10)
    expect(Array.from(alpha)).toEqual(Array.from(mask))
  })
})

describe('flatBackdrop', () => {
  it('finds a white page behind the subject', () => {
    const w = 40
    const h = 40
    const rgba = solid(w, h, [255, 255, 255])
    paint(rgba, w, [10, 10, 30, 30], [200, 50, 50])
    const mask = new Float32Array(w * h)
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) mask[y * w + x] = 1
    expect(flatBackdrop(rgba, mask, w, h)).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('says no for a busy photo background', () => {
    const w = 40
    const h = 40
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) rgba.set([(i * 53) % 256, (i * 97) % 256, (i * 151) % 256, 255], i * 4)
    expect(flatBackdrop(rgba, new Float32Array(w * h), w, h)).toBeNull()
  })
})

describe('keyOutBackdrop', () => {
  it('cuts away backdrop the mask spilled onto but keeps enclosed parts of the same colour', () => {
    const w = 60
    const h = 60
    const white: [number, number, number] = [255, 255, 255]
    const rgba = solid(w, h, white)
    // A brown-outlined "glove": white inside a closed brown ring.
    paint(rgba, w, [10, 10, 40, 40], [120, 60, 30])
    paint(rgba, w, [15, 15, 35, 35], white)
    // The mask spilled well past the subject.
    const alpha = new Float32Array(w * h)
    for (let y = 5; y < 50; y++) for (let x = 5; x < 50; x++) alpha[y * w + x] = 1
    keyOutBackdrop(rgba, alpha, w, h, { r: 255, g: 255, b: 255 })
    expect(alpha[7 * w + 7]).toBe(0) // spill outside the outline
    expect(alpha[45 * w + 45]).toBe(0)
    expect(alpha[25 * w + 25]).toBe(1) // the white glove stays
    expect(alpha[12 * w + 12]).toBe(1) // the outline itself
  })
})

describe('decontaminate', () => {
  it('gives soft edge pixels the subject colour instead of the background tint', () => {
    const w = 10
    const h = 1
    const rgba = new Uint8ClampedArray(w * 4)
    for (let x = 0; x < 5; x++) rgba.set([200, 100, 0, 255], x * 4)
    rgba.set([230, 120, 180, 128], 5 * 4) // half-transparent, tinted pink by the backdrop
    decontaminate(rgba, w, h)
    expect(Array.from(rgba.slice(20, 24))).toEqual([200, 100, 0, 128])
  })
})
