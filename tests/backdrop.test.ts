import { describe, expect, it } from 'vitest'
import { fitBackdrop, keepSubjectPieces, matteOnBackdrop } from '../src/lib/backdrop'

type RGB = [number, number, number]

/** A test picture: a backdrop with shapes painted on (no anti-aliasing unless painted). */
class Picture {
  data: Uint8ClampedArray
  constructor(
    public width: number,
    public height: number,
    backdrop: (x: number, y: number) => RGB,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) this.set(x, y, backdrop(x, y))
  }
  set(x: number, y: number, c: RGB) {
    this.data.set([...c, 255], (y * this.width + x) * 4)
  }
  /** Fills pixels whose centre is inside `test`. */
  paint(test: (x: number, y: number) => boolean, c: RGB) {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) if (test(x, y)) this.set(x, y, c)
  }
  /** Everything inside an ellipse counts as "inside the user's loop". */
  loop(cx: number, cy: number, rx: number, ry: number) {
    const inside = new Uint8Array(this.width * this.height)
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) inside[y * this.width + x] = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 ? 1 : 0
    return inside
  }
}

const WHITE: RGB = [255, 255, 255]
const PINK: RGB = [255, 227, 236]
const INK: RGB = [30, 26, 32]
const LAVENDER: RGB = [239, 220, 240]
const ring = (cx: number, cy: number, r0: number, r1: number) => (x: number, y: number) => {
  const d = Math.hypot(x - cx, y - cy)
  return d >= r0 && d <= r1
}
const disc = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) <= r

describe('fitBackdrop', () => {
  it('fits a flat page and a gentle gradient, and refuses a busy photo', () => {
    const all = (p: Picture) => new Uint8Array(p.width * p.height).fill(1)
    const flat = new Picture(60, 40, () => WHITE)
    expect(fitBackdrop(flat.data, 60, 40, all(flat))).not.toBeNull()
    const gradient = new Picture(60, 40, (x) => [255 - x, 255 - x / 2, 255])
    expect(fitBackdrop(gradient.data, 60, 40, all(gradient))).not.toBeNull()
    let seed = 1
    const noise = () => ((seed = (seed * 16807) % 2147483647) % 256)
    const busy = new Picture(60, 40, () => [noise(), noise(), noise()])
    expect(fitBackdrop(busy.data, 60, 40, all(busy))).toBeNull()
  })
})

describe('matteOnBackdrop', () => {
  it('keeps white parts enclosed by an outline (a ghost on a white page)', () => {
    const p = new Picture(120, 120, () => WHITE)
    p.paint(ring(60, 60, 30, 36), INK)
    p.paint(disc(60, 60, 30), [246, 247, 251]) // near-white body
    const m = matteOnBackdrop(p.data, 120, 120, p.loop(60, 60, 50, 50))!
    expect(m.alpha[60 * 120 + 60]).toBe(1) // body kept
    expect(m.alpha[60 * 120 + 5]).toBe(0) // page gone
  })

  it("cuts out an enclosed area matching a coloured page (inside a bag's handle)", () => {
    const p = new Picture(120, 120, () => PINK)
    p.paint(ring(60, 60, 30, 34), INK) // the handle, a closed loop
    const m = matteOnBackdrop(p.data, 120, 120, p.loop(60, 60, 50, 50))!
    expect(m.alpha[60 * 120 + 60]).toBe(0) // see-through
    expect(m.alpha[60 * 120 + 92]).toBe(1) // the handle itself
  })

  it('keeps light colours and white highlights inside a light bag on a white page', () => {
    const p = new Picture(120, 120, () => WHITE)
    p.paint((x, y) => x >= 30 && x < 90 && y >= 30 && y < 90, INK)
    p.paint((x, y) => x >= 34 && x < 86 && y >= 34 && y < 86, LAVENDER)
    p.paint((x, y) => y === 50 && x >= 45 && x < 75, WHITE) // a highlight stroke
    const m = matteOnBackdrop(p.data, 120, 120, p.loop(60, 60, 55, 55))!
    expect(m.alpha[60 * 120 + 60]).toBe(1)
    expect(m.alpha[50 * 120 + 60]).toBe(1)
  })

  it('keeps a thin string attached to the subject, with exact soft edges', () => {
    const p = new Picture(120, 120, () => WHITE)
    p.paint(disc(60, 80, 20), INK)
    p.paint((x, y) => x === 60 && y >= 20 && y < 62, INK) // 1px string
    p.set(61, 40, [142, 140, 143]) // a half-covered pixel beside it
    const m = matteOnBackdrop(p.data, 120, 120, p.loop(60, 60, 50, 55))!
    expect(m.alpha[30 * 120 + 60]).toBe(1)
    expect(m.alpha[40 * 120 + 61]).toBeCloseTo(0.5, 1)
    // Un-blended colour: the ink, not grey.
    expect(m.rgba[(40 * 120 + 61) * 4]).toBeLessThan(45)
  })

  it('drops a thin watermark under the subject but keeps a solid cherry on top', () => {
    const p = new Picture(160, 160, () => WHITE)
    p.paint(disc(80, 85, 35), [247, 198, 217])
    p.paint(disc(80, 35, 9), [232, 54, 79]) // cherry, separate
    p.paint((x, y) => y === 130 && x >= 40 && x < 120, [150, 150, 150]) // watermark line
    const m = matteOnBackdrop(p.data, 160, 160, p.loop(80, 80, 70, 75))!
    expect(m.alpha[35 * 160 + 80]).toBe(1)
    expect(m.alpha[130 * 160 + 80]).toBe(0)
  })

  it('handles a gradient backdrop', () => {
    const p = new Picture(120, 120, (x, y) => [255 - x / 4, 255 - y / 8, 255])
    p.paint(disc(60, 60, 25), [91, 181, 68])
    const m = matteOnBackdrop(p.data, 120, 120, p.loop(60, 60, 45, 45))!
    expect(m.alpha[60 * 120 + 60]).toBe(1)
    expect(m.alpha[60 * 120 + 100]).toBe(0)
  })

  it('refuses busy backgrounds', () => {
    let seed = 3
    const noise = () => ((seed = (seed * 16807) % 2147483647) % 256)
    const p = new Picture(80, 80, () => [noise(), noise(), noise()])
    expect(matteOnBackdrop(p.data, 80, 80, p.loop(40, 40, 30, 30))).toBeNull()
  })
})

describe('keepSubjectPieces', () => {
  it('keeps pieces mostly inside the loop and drops ones mostly outside', () => {
    const w = 100
    const h = 100
    const fg = new Uint8Array(w * h)
    for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) fg[y * w + x] = 1 // subject
    for (let y = 70; y < 90; y++) for (let x = 75; x < 95; x++) fg[y * w + x] = 1 // other object
    const inside = new Uint8Array(w * h)
    for (let y = 10; y < 65; y++) for (let x = 10; x < 65; x++) inside[y * w + x] = 1
    keepSubjectPieces(fg, w, h, inside)
    expect(fg[40 * w + 40]).toBe(1)
    expect(fg[80 * w + 85]).toBe(0)
  })
})
