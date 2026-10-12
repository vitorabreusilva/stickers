import { describe, expect, it } from 'vitest'
import { boundingBox, decimate, finishLasso, intersectRect, polygonArea, smoothClosed } from '../src/lib/geometry'

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
]

describe('geometry', () => {
  it('computes polygon area regardless of winding', () => {
    expect(polygonArea(square)).toBe(100)
    expect(polygonArea([...square].reverse())).toBe(100)
  })

  it('drops points that are too close together', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 2, y: 0 },
      { x: 2.4, y: 0.4 },
      { x: 4, y: 0 },
    ]
    expect(decimate(pts, 1.5)).toEqual([pts[0], pts[2], pts[4]])
  })

  it('smooths a closed polygon while staying inside its hull', () => {
    const smooth = smoothClosed(square, 2)
    expect(smooth).toHaveLength(16)
    const box = boundingBox(smooth)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(10)
    // Corners are cut, edges mostly kept.
    expect(smooth).not.toContainEqual({ x: 0, y: 0 })
    expect(polygonArea(smooth)).toBeLessThan(100)
    expect(polygonArea(smooth)).toBeGreaterThan(70)
  })

  it('snaps and clips rects to whole pixels', () => {
    expect(intersectRect({ x: -3.2, y: 4.6, width: 20, height: 3 }, { x: 0, y: 0, width: 10, height: 10 })).toEqual({
      x: 0,
      y: 4,
      width: 10,
      height: 4,
    })
    expect(intersectRect({ x: 20, y: 20, width: 5, height: 5 }, { x: 0, y: 0, width: 10, height: 10 }).width).toBe(0)
  })

  it('turns a rough circle into a loop and rejects scribbles that are too small', () => {
    const circle = Array.from({ length: 60 }, (_, i) => ({
      x: 50 + 40 * Math.cos((i / 60) * Math.PI * 2),
      y: 50 + 40 * Math.sin((i / 60) * Math.PI * 2),
    }))
    const loop = finishLasso(circle, 1, 100)
    expect(loop).not.toBeNull()
    expect(polygonArea(loop!)).toBeGreaterThan(Math.PI * 38 * 38)

    expect(finishLasso(circle, 1, 10_000)).toBeNull()
    expect(finishLasso([{ x: 0, y: 0 }, { x: 5, y: 5 }], 1, 0)).toBeNull()
  })
})
