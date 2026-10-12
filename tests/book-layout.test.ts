import { describe, expect, it } from 'vitest'
import { ART_BOX, collageLayout, FOOTER_BOX, fitBox, PAGE_PX } from '../src/lib/book-layout'

describe('page geometry', () => {
  it('is A5 at 300 dpi with the drawing and footer inside the margins', () => {
    expect(PAGE_PX).toEqual({ width: 1748, height: 2480 })
    expect(ART_BOX.x).toBeGreaterThan(0)
    expect(FOOTER_BOX.y).toBeGreaterThan(ART_BOX.y + ART_BOX.height)
    expect(FOOTER_BOX.y + FOOTER_BOX.height).toBeLessThan(PAGE_PX.height)
  })

  it('fits keeping proportions', () => {
    const box = fitBox(2, { x: 0, y: 0, width: 100, height: 100 })
    expect(box).toEqual({ x: 0, y: 25, width: 100, height: 50 })
  })
})

describe('collageLayout', () => {
  const box = { x: 100, y: 200, width: 1000, height: 1400 }

  it.each([1, 2, 3, 7, 20])('places %i stickers on the cover without leaving it', (n) => {
    const aspects = Array.from({ length: n }, (_, i) => [1, 0.7, 1.5][i % 3])
    const placements = collageLayout(aspects, box)
    expect(placements).toHaveLength(n)
    for (const p of placements) {
      const halfW = (p.width * Math.abs(Math.cos(p.rotation)) + p.height * Math.abs(Math.sin(p.rotation))) / 2
      const halfH = (p.width * Math.abs(Math.sin(p.rotation)) + p.height * Math.abs(Math.cos(p.rotation))) / 2
      expect(p.cx - halfW).toBeGreaterThanOrEqual(box.x - 0.5)
      expect(p.cx + halfW).toBeLessThanOrEqual(box.x + box.width + 0.5)
      expect(p.cy - halfH).toBeGreaterThanOrEqual(box.y - 0.5)
      expect(p.cy + halfH).toBeLessThanOrEqual(box.y + box.height + 0.5)
      expect(p.width / p.height).toBeCloseTo(aspects[placements.indexOf(p)], 5)
    }
  })

  it('looks the same every time', () => {
    expect(collageLayout([1, 1, 1], box)).toEqual(collageLayout([1, 1, 1], box))
  })
})
