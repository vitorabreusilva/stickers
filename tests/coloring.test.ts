import { describe, expect, it } from 'vitest'
import { lineBounds, renderLines, traceLines } from '../src/lib/coloring'

const W = 120
const H = 120

/** A transparent canvas to paint rectangles and circles on. */
function canvas() {
  const data = new Uint8ClampedArray(W * H * 4)
  const paint = (inside: (x: number, y: number) => boolean, [r, g, b]: number[]) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!inside(x, y)) continue
        const i = (y * W + x) * 4
        data.set([r, g, b, 255], i)
      }
    }
  }
  return { data, paint }
}

const at = (field: Float32Array, x: number, y: number) => field[y * W + x]

describe('traceLines', () => {
  it('draws a line where two colours meet, and none inside flat areas', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 10 && x < 110 && y >= 10 && y < 110, [230, 40, 40])
    paint((x, y) => x >= 60 && x < 110 && y >= 10 && y < 110, [40, 90, 230])
    const fields = traceLines(data, W, H, 'medium')
    expect(at(fields.regions, 59, 60)).toBeLessThanOrEqual(1)
    expect(at(fields.regions, 30, 60)).toBeGreaterThan(10)
    expect(at(fields.regions, 85, 60)).toBeGreaterThan(10)
    // The silhouette gets its own outline.
    expect(at(fields.outline, 10, 60)).toBe(0)
  })

  it('keeps thin dark strokes as ink, but not wide dark areas', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 10 && x < 110 && y >= 10 && y < 110, [255, 200, 60])
    paint((x, y) => x >= 58 && x < 61 && y >= 20 && y < 100, [20, 20, 25])
    paint((x, y) => x >= 20 && x < 45 && y >= 20 && y < 100, [20, 20, 25])
    const fields = traceLines(data, W, H, 'medium')
    expect(at(fields.ink, 59, 60)).toBe(0)
    // The middle of the wide dark block is a space to colour, not a blob of ink.
    expect(at(fields.ink, 32, 60)).toBeGreaterThan(3)
    expect(at(fields.regions, 32, 60)).toBeGreaterThan(3)
  })

  it("doesn't cut a smooth gradient into bands", () => {
    const { data, paint } = canvas()
    for (let x = 10; x < 110; x++) {
      const t = (x - 10) / 99
      paint((px, py) => px === x && py >= 10 && py < 110, [Math.round(250 - 150 * t), Math.round(120 - 90 * t), 40])
    }
    const fields = traceLines(data, W, H, 'detailed')
    let lines = 0
    for (let x = 15; x < 105; x++) if (at(fields.regions, x, 60) <= 1) lines++
    expect(lines).toBe(0)
  })

  it('leaves the white die-cut border off the page', () => {
    const { data, paint } = canvas()
    paint((x, y) => (x - 60) ** 2 + (y - 60) ** 2 < 50 ** 2, [255, 255, 255])
    paint((x, y) => (x - 60) ** 2 + (y - 60) ** 2 < 42 ** 2, [60, 170, 80])
    const fields = traceLines(data, W, H, 'medium')
    // The outline follows the green disc, not the white ring around it.
    expect(at(fields.outline, 60, 60 - 41)).toBeLessThanOrEqual(1)
    expect(at(fields.outline, 60, 60 - 49)).toBeGreaterThan(5)
    const bounds = lineBounds(fields, 0)
    expect(bounds.width).toBeLessThanOrEqual(86)
  })
})

describe('renderLines', () => {
  it('draws lines of the requested width at a bigger size', () => {
    const { data, paint } = canvas()
    paint((x, y) => x >= 20 && x < 100 && y >= 20 && y < 100, [230, 40, 40])
    const fields = traceLines(data, W, H, 'simple')
    const out = renderLines(fields, W * 3, H * 3, { line: 4, outline: 9 })
    const alpha = (x: number, y: number) => out[(y * W * 3 + x) * 4 + 3]
    expect(alpha(180, 180)).toBe(0)
    expect(alpha(20 * 3 + 1, 180)).toBe(255)
    let run = 0
    for (let x = 40; x < 100; x++) if (alpha(x, 180) > 127) run++
    expect(run).toBeGreaterThanOrEqual(8)
    expect(run).toBeLessThanOrEqual(11)
  })
})
