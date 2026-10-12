import { describe, expect, it } from 'vitest'
import { createTiltTracker, idleLight, pointerLight } from '../src/lib/light'

describe('tilt', () => {
  it('starts centered on however the phone is held', () => {
    const track = createTiltTracker()
    const { x, y } = track(40, 5)
    expect([x + 0, y + 0]).toEqual([0, 0])
  })

  it('moves the light as the phone tilts, and clamps it', () => {
    const track = createTiltTracker()
    track(40, 0)
    const right = track(40, 11)
    expect(right.x).toBeLessThan(-0.4)
    expect(Math.abs(right.y)).toBeLessThan(0.01)
    const forward = track(51, 0)
    expect(forward.y).toBeLessThan(-0.4)
    expect(track(40, 80).x).toBe(-1)
  })

  it('handles beta wrapping around when the phone tips over', () => {
    const track = createTiltTracker()
    track(178, 0)
    // -178 is 4 degrees further, not 356 back.
    const light = track(-178, 0)
    expect(light.y).toBeCloseTo(-4 / 22, 2)
  })

  it('recenters slowly while held at a new angle', () => {
    const track = createTiltTracker()
    track(40, 0)
    const first = track(40, 10).x
    let last = first
    for (let i = 0; i < 600; i++) last = track(40, 10).x
    expect(Math.abs(last)).toBeLessThan(Math.abs(first) * 0.2)
  })

  it('turns with the screen', () => {
    const portrait = createTiltTracker()
    const landscape = createTiltTracker()
    portrait(40, 0)
    landscape(40, 0)
    const p = portrait(40, 11)
    const l = landscape(40, 11, 90)
    expect(l.x).toBeCloseTo(-p.y)
    expect(l.y).toBeCloseTo(p.x)
  })
})

describe('idle drift', () => {
  it('stays in range and keeps moving', () => {
    const seen = new Set<string>()
    for (let t = 0; t < 60; t += 0.5) {
      const { x, y } = idleLight(t)
      expect(Math.abs(x)).toBeLessThanOrEqual(1)
      expect(Math.abs(y)).toBeLessThanOrEqual(1)
      seen.add(`${x.toFixed(2)},${y.toFixed(2)}`)
    }
    expect(seen.size).toBeGreaterThan(50)
  })
})

describe('pointerLight', () => {
  it('maps the screen to -1…1', () => {
    expect(pointerLight(0, 0, 400, 800)).toEqual({ x: -1, y: -1 })
    expect(pointerLight(200, 400, 400, 800)).toEqual({ x: 0, y: 0 })
    expect(pointerLight(500, 900, 400, 800)).toEqual({ x: 1, y: 1 })
  })
})
