import { describe, expect, it } from 'vitest'
import { lineBounds, renderLines, resizeBicubic, traceLines, type LineFields } from '../src/lib/coloring'

// Shapes are laid out on a 120-unit grid and drawn three pixels per unit, about the size of a
// small sticker. Fields come back enlarged again, at nine field pixels per unit.
const UNIT = 3
const W = 120 * UNIT
const H = 120 * UNIT

/** A transparent canvas to paint shapes on, in grid units. */
function canvas() {
  const data = new Uint8ClampedArray(W * H * 4)
  const paint = (inside: (x: number, y: number) => boolean, [r, g, b]: number[]) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!inside((x + 0.5) / UNIT, (y + 0.5) / UNIT)) continue
        data.set([r, g, b, 255], (y * W + x) * 4)
      }
    }
  }
  return { data, paint }
}

/** A field's value at grid point (x, y). */
const at = (fields: LineFields, field: Float32Array, x: number, y: number) => {
  const k = fields.width / 120
  return field[Math.floor(y * k) * fields.width + Math.floor(x * k)]
}

/** The smallest value along a row of the grid between x0 and x1. */
const minAlong = (fields: LineFields, field: Float32Array, x0: number, x1: number, y: number) => {
  let m = Infinity
  for (let x = x0; x <= x1; x += 0.05) m = Math.min(m, at(fields, field, x, y))
  return m
}

describe('traceLines', () => {
  it('works on the sticker enlarged, so lines land between its pixels', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 10 && x < 110 && y >= 10 && y < 110, [230, 40, 40])
    const fields = traceLines(data, W, H, 'medium')
    expect(fields.width).toBe(W * 3)
    expect(fields.bounds).toEqual({ x: 90, y: 90, width: 900, height: 900 })
  })

  it('draws a line where two colours meet, and none inside flat areas', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 10 && x < 110 && y >= 10 && y < 110, [230, 40, 40])
    paint((x, y) => x >= 60 && x < 110 && y >= 10 && y < 110, [40, 90, 230])
    const fields = traceLines(data, W, H, 'medium')
    expect(minAlong(fields, fields.regions, 59, 61, 60)).toBeLessThanOrEqual(1.5)
    expect(at(fields, fields.regions, 30, 60)).toBeGreaterThan(30)
    expect(at(fields, fields.regions, 85, 60)).toBeGreaterThan(30)
    // The colour edge isn't mistaken for a stroke: it isn't darker than both sides.
    expect(minAlong(fields, fields.ink, 58, 62, 60)).toBeGreaterThan(5)
    // The silhouette gets its own outline.
    expect(minAlong(fields, fields.outline, 9, 11, 60)).toBeLessThanOrEqual(1.5)
  })

  it('keeps strokes at their own width, even pale ones', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 10 && x < 110 && y >= 10 && y < 110, [255, 230, 120])
    paint((x, y) => x >= 40 && x < 43 && y >= 20 && y < 100, [20, 20, 25])
    paint((x, y) => x >= 80 && x < 82 && y >= 20 && y < 100, [140, 180, 230])
    const fields = traceLines(data, W, H, 'medium')
    expect(at(fields, fields.ink, 41.5, 60)).toBeLessThan(0)
    expect(at(fields, fields.ink, 81, 60)).toBeLessThan(0)
    // A third of a unit past either edge is already outside the stroke.
    expect(at(fields, fields.ink, 39.6, 60)).toBeGreaterThan(0)
    expect(at(fields, fields.ink, 43.4, 60)).toBeGreaterThan(0)
    expect(at(fields, fields.ink, 79.6, 60)).toBeGreaterThan(0)
    expect(at(fields, fields.ink, 82.4, 60)).toBeGreaterThan(0)
  })

  it('keeps small black shapes filled and hollows out big ones', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 5 && x < 115 && y >= 5 && y < 115, [250, 210, 180])
    paint((x, y) => (x - 30) ** 2 + (y - 30) ** 2 < 5 ** 2, [15, 15, 20])
    paint((x, y) => x >= 50 && x < 105 && y >= 50 && y < 105, [15, 15, 20])
    const fields = traceLines(data, W, H, 'medium')
    // The pupil stays black...
    expect(at(fields, fields.ink, 30, 30)).toBeLessThan(0)
    // ...the big block keeps its edge but is open inside, to be coloured.
    expect(minAlong(fields, fields.ink, 49, 52, 77)).toBeLessThan(0)
    expect(at(fields, fields.ink, 77, 77)).toBeGreaterThan(5)
  })

  it("doesn't cut a smooth gradient into bands", () => {
    const { data, paint } = canvas()
    for (let x = 10; x < 110; x++) {
      const t = (x - 10) / 99
      paint((px, py) => px === x && py >= 10 && py < 110, [Math.round(250 - 150 * t), Math.round(120 - 90 * t), 40])
    }
    const fields = traceLines(data, W, H, 'detailed')
    let lines = 0
    for (let x = 15; x < 105; x++) if (at(fields, fields.regions, x, 60) <= 1.5) lines++
    expect(lines).toBe(0)
  })

  it('leaves the white die-cut border off the page', () => {
    const { data, paint } = canvas()
    paint((x, y) => (x - 60) ** 2 + (y - 60) ** 2 < 50 ** 2, [255, 255, 255])
    paint((x, y) => (x - 60) ** 2 + (y - 60) ** 2 < 42 ** 2, [60, 170, 80])
    const fields = traceLines(data, W, H, 'medium')
    // The outline follows the green disc, not the white ring around it.
    let nearest = Infinity
    for (let y = 16; y <= 22; y += 0.05) nearest = Math.min(nearest, at(fields, fields.outline, 60, y))
    expect(nearest).toBeLessThanOrEqual(1.5)
    expect(at(fields, fields.outline, 60, 11)).toBeGreaterThan(15)
    const bounds = lineBounds(fields, 0)
    expect(bounds.width / 9).toBeLessThanOrEqual(87)
  })

  it('drops white background inside an inked drawing, with no second outline along the ink', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 4 && x < 116 && y >= 4 && y < 116, [255, 255, 255])
    // A ring drawn in black ink, coloured inside.
    paint((x, y) => (x - 60) ** 2 + (y - 60) ** 2 < 40 ** 2, [20, 20, 20])
    paint((x, y) => (x - 60) ** 2 + (y - 60) ** 2 < 37 ** 2, [255, 190, 60])
    const fields = traceLines(data, W, H, 'medium')
    expect(fields.bounds.width / 9).toBeLessThanOrEqual(82)
    expect(at(fields, fields.ink, 60, 21.5)).toBeLessThan(0)
    // The ink is the outline; no extra silhouette line is drawn beside it.
    expect(fields.outline.reduce((m, v) => Math.min(m, v), Infinity)).toBeGreaterThan(5)
  })
})

describe('resizeBicubic', () => {
  it("enlarges without dark fringes at transparent edges", () => {
    const src = new Uint8ClampedArray(4 * 4 * 4)
    for (let i = 0; i < 4; i++) src.set([255, 255, 255, 255], (1 * 4 + i) * 4)
    const out = resizeBicubic(src, 4, 4, 12, 12)
    for (let i = 0; i < 144; i++) if (out[i * 4 + 3] > 20) expect(out[i * 4]).toBeGreaterThan(240)
  })
})

describe('renderLines', () => {
  it('draws lines of the requested width at a bigger size', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 20 && x < 100 && y >= 20 && y < 100, [230, 40, 40])
    const fields = traceLines(data, W, H, 'simple')
    const out = renderLines(fields, W * 3, H * 3, { line: 4, outline: 9 })
    // The square spans 180–900 px across the 1080 px drawing.
    const alpha = (x: number, y: number) => out[(y * W * 3 + x) * 4 + 3]
    expect(alpha(540, 540)).toBe(0)
    expect(alpha(181, 540)).toBe(255)
    let run = 0
    for (let x = 150; x < 260; x++) if (alpha(x, 540) > 127) run++
    expect(run).toBeGreaterThanOrEqual(8)
    expect(run).toBeLessThanOrEqual(11)
  })
})
