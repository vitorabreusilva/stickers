import { describe, expect, it } from 'vitest'
import { stampLayout } from '../src/lib/stamp'

describe('stamp layout', () => {
  it('puts the picture inside a white margin', () => {
    const layout = stampLayout(800, 600)
    expect(layout.margin).toBe(60)
    expect(layout.width).toBe(920)
    expect(layout.height).toBe(720)
    // Holes bite into the margin but never reach the picture.
    expect(layout.radius).toBeLessThan(layout.margin / 2)
  })

  it('keeps a usable margin on small pictures', () => {
    expect(stampLayout(40, 30).margin).toBe(14)
  })

  it('perforates every edge evenly, with a hole on each corner', () => {
    const { width, height, holes, radius } = stampLayout(1000, 500)
    // Every hole sits on the outer edge.
    for (const { x, y } of holes) expect(x === 0 || x === width || y === 0 || y === height).toBe(true)
    for (const corner of [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: height },
      { x: width, y: height },
    ]) {
      expect(holes).toContainEqual(corner)
    }
    // No hole twice, and the same gap between neighbours all along an edge.
    expect(new Set(holes.map((h) => `${h.x},${h.y}`)).size).toBe(holes.length)
    const top = holes.filter((h) => h.y === 0).map((h) => h.x).sort((a, b) => a - b)
    const gaps = top.slice(1).map((x, i) => x - top[i])
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6)
    // Holes are apart, so the paper between them holds together.
    expect(gaps[0]).toBeGreaterThan(radius * 2)
  })
})
