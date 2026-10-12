import { describe, expect, it } from 'vitest'
import {
  applyTone,
  backgroundBox,
  EFFECT_INFO,
  EFFECTS,
  effectOf,
  farthestCorner,
  fillCss,
  gradientLine,
  isAnimated,
  layerStyle,
  toneCss,
  toneMatrix,
  type Fill,
  type ToneOp,
} from '../src/lib/effects'
import { grain, random, sparkles } from '../src/lib/textures'

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba)

describe('effectOf', () => {
  it('keeps known effects', () => {
    for (const effect of EFFECTS) expect(effectOf(effect)).toBe(effect)
  })

  it("reads stickers saved before effects existed, or anything unknown, as 'none'", () => {
    expect(effectOf(undefined)).toBe('none')
    expect(effectOf(null)).toBe('none')
    expect(effectOf('sparkly')).toBe('none')
    expect(effectOf(3)).toBe('none')
  })
})

describe('effect catalog', () => {
  it('names every effect and only animates the foils', () => {
    for (const effect of EFFECTS) expect(EFFECT_INFO[effect].name).toBeTruthy()
    expect(isAnimated('none')).toBe(false)
    expect(isAnimated('matte')).toBe(false)
    for (const effect of ['holo', 'chrome', 'gold', 'glitter', 'glossy'] as const) expect(isAnimated(effect)).toBe(true)
  })
})

describe('tone', () => {
  it('writes CSS filter functions in order', () => {
    expect(toneCss([['grayscale', 1], ['contrast', 1.3], ['hue-rotate', -8]])).toBe(
      'grayscale(1) contrast(1.3) hue-rotate(-8deg)',
    )
  })

  it('matches the CSS filter math', () => {
    const gray = px(255, 0, 0, 255)
    applyTone(gray, [['grayscale', 1]])
    // Red's luminance, on every channel.
    expect([...gray]).toEqual([54, 54, 54, 255])

    const contrast = px(64, 128, 192, 255)
    applyTone(contrast, [['contrast', 2]])
    expect([...contrast]).toEqual([0, 129, 255, 255])

    const bright = px(100, 100, 100, 200)
    applyTone(bright, [['brightness', 1.5]])
    expect([...bright]).toEqual([150, 150, 150, 200])
  })

  it('leaves colors alone at neutral amounts', () => {
    const neutral: ToneOp[] = [['saturate', 1], ['contrast', 1], ['brightness', 1], ['hue-rotate', 0], ['sepia', 0], ['grayscale', 0]]
    const pixels = px(12, 200, 99, 255, 250, 3, 77, 128)
    applyTone(pixels, neutral)
    expect([...pixels]).toEqual([12, 200, 99, 255, 250, 3, 77, 128])
  })

  it('clamps between steps like a CSS filter chain', () => {
    // Brightening white past 1 and then darkening gives 0.5, not 1.
    const pixels = px(255, 255, 255, 255)
    applyTone(pixels, [['brightness', 2], ['brightness', 0.5]])
    expect([...pixels]).toEqual([128, 128, 128, 255])
  })

  it('skips fully transparent pixels', () => {
    const pixels = px(255, 0, 0, 0)
    applyTone(pixels, [['grayscale', 1]])
    expect([...pixels]).toEqual([255, 0, 0, 0])
  })

  it('keeps grays gray when saturating', () => {
    const { m } = toneMatrix(['saturate', 1.7])
    expect(m[0] + m[1] + m[2]).toBeCloseTo(1)
    expect(m[3] + m[4] + m[5]).toBeCloseTo(1)
    expect(m[6] + m[7] + m[8]).toBeCloseTo(1)
  })
})

describe('layer CSS', () => {
  const linear: Fill = { kind: 'linear', angle: 115, stops: [['#fff', 0], ['#000', 1]], size: 3, travel: 1 }

  it('follows the live light through custom properties', () => {
    const css = fillCss(linear)
    expect(css.image).toBe('linear-gradient(115deg, #fff 0%, #000 100%)')
    expect(css.size).toBe('300% 300%')
    expect(css.position).toBe('calc(50% + var(--fx-x, 0) * 50%) calc(50% + var(--fx-y, 0) * 50%)')
  })

  it('freezes at a given light', () => {
    expect(fillCss(linear, { x: -1, y: 0.5 }).position).toBe('0% 75%')
    const glare = fillCss({ kind: 'radial', stops: [['#fff', 0]], travel: 0.8 }, { x: 0.5, y: -0.5 })
    expect(glare.image).toBe('radial-gradient(circle farthest-corner at 70% 30%, #fff 0%)')
    const texture = fillCss({ kind: 'texture', texture: 'sparkle', tile: 96, travel: 14 }, { x: 1, y: -1 })
    expect(texture).toMatchObject({ image: 'var(--fx-sparkle)', size: '96px 96px', position: '14px -14px', repeat: 'repeat' })
  })

  it("doesn't reference the light for layers that don't move", () => {
    expect(fillCss({ ...linear, travel: 0 }).position).toBe('50% 50%')
  })

  it('lists fills top first, with their blend', () => {
    const style = layerStyle(EFFECT_INFO.glitter.layers[1])
    expect(style.backgroundImage.split(', var(')[1]).toBe('--fx-sparkle)')
    expect(style.backgroundBlendMode).toBe('multiply, multiply')
    expect(style.mixBlendMode).toBe('color-dodge')
  })
})

describe('background geometry', () => {
  it('runs gradient lines the way CSS does', () => {
    const box = { x: 0, y: 0, width: 200, height: 100 }
    const right = gradientLine(90, box)
    expect(right.x0).toBeCloseTo(0)
    expect(right.y0).toBeCloseTo(50)
    expect(right.x1).toBeCloseTo(200)
    expect(right.y1).toBeCloseTo(50)
    const down = gradientLine(180, box)
    expect([down.x0, down.y0, down.x1, down.y1].map((v) => Math.round(v) + 0)).toEqual([100, 0, 100, 100])
    // Diagonals reach the corners' perpendiculars: length is |w sin a| + |h cos a|.
    const diag = gradientLine(45, { x: 0, y: 0, width: 100, height: 100 })
    expect(Math.hypot(diag.x1 - diag.x0, diag.y1 - diag.y0)).toBeCloseTo(100 * Math.SQRT2)
  })

  it('places oversized backgrounds by percentage', () => {
    expect(backgroundBox(100, 50, 3, 0, 0)).toMatchObject({ width: 300, height: 150 })
    expect(backgroundBox(100, 50, 3, 1, 1)).toEqual({ x: -200, y: -100, width: 300, height: 150 })
    expect(backgroundBox(100, 50, 3, 0.5, 0.5)).toEqual({ x: -100, y: -50, width: 300, height: 150 })
  })

  it('measures to the farthest corner', () => {
    expect(farthestCorner(0, 0, 30, 40)).toBe(50)
    expect(farthestCorner(30, 40, 30, 40)).toBe(50)
  })
})

describe('textures', () => {
  it('are the same on every load', () => {
    expect(sparkles(1, 20, 192)).toEqual(sparkles(1, 20, 192))
    expect(sparkles(1, 20, 192)).not.toEqual(sparkles(2, 20, 192))
    const a = random(5)
    const b = random(5)
    for (let i = 0; i < 10; i++) expect(a()).toBe(b())
  })

  it('keeps sparkles on the tile', () => {
    for (const s of sparkles(3, 200, 64)) {
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThan(64)
      expect(s.brightness).toBeGreaterThan(0)
      expect(s.brightness).toBeLessThanOrEqual(1)
    }
  })

  it('makes grain that averages out to neutral gray', () => {
    const pixels = grain(7, 64)
    let sum = 0
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i + 3]).toBe(255)
      sum += pixels[i]
    }
    expect(sum / (64 * 64)).toBeCloseTo(128, -1)
  })
})
