/**
 * Finishes a sticker can have: metallic, holographic and so on. Each one is plain data (a color
 * adjustment plus a few blended layers) so the same description drives both the live CSS
 * rendering and the static frame baked into exported images (see effect-render.ts).
 */

export type StickerEffect = 'none' | 'holo' | 'chrome' | 'gold' | 'glitter' | 'glossy' | 'matte'

export const EFFECTS: StickerEffect[] = ['none', 'holo', 'chrome', 'gold', 'glitter', 'glossy', 'matte']

/** Where the light comes from, -1…1 on each axis (left/top to right/bottom). */
export interface Light {
  x: number
  y: number
}

/** The light used when nothing is moving it, and for exported images: from the top left. */
export const RESTING_LIGHT: Light = { x: -0.35, y: -0.45 }

/** A CSS filter function and its amount (hue-rotate in degrees). Applied in order. */
export type ToneOp = ['grayscale' | 'sepia' | 'saturate' | 'brightness' | 'contrast' | 'hue-rotate', number]

export type Blend =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'color-dodge'
  | 'soft-light'
  | 'hard-light'
  | 'color'
  | 'luminosity'

/** A color and its position along the gradient, 0…1. */
export type Stop = [string, number]

export type TextureName = 'sparkle' | 'sparkle2' | 'grain'

export type Fill =
  /** A gradient `size` times bigger than the sticker that slides across it as the light moves. */
  | { kind: 'linear'; angle: number; stops: Stop[]; size: number; travel: number }
  /** A glare centered where the light falls. */
  | { kind: 'radial'; stops: Stop[]; travel: number }
  /** A repeating texture, `tile` CSS pixels square, shifted up to `travel` pixels by the light. */
  | { kind: 'texture'; texture: TextureName; tile: number; travel: number }

export interface Layer {
  /** Topmost first, like CSS backgrounds. */
  fills: Fill[]
  /** How each fill blends with the ones under it. */
  fillBlend?: Blend
  /** How the layer blends with the sticker. */
  blend: Blend
  opacity: number
}

export interface EffectInfo {
  name: string
  tone: ToneOp[]
  /** Bottom first. Every layer is masked to the sticker's shape. */
  layers: Layer[]
}

/** `colors` repeated `cycles` times along a gradient, wrapping back to the first. */
export function bands(colors: string[], cycles: number): Stop[] {
  const count = colors.length * cycles
  return Array.from({ length: count + 1 }, (_, i) => [colors[i % colors.length], i / count])
}

const RAINBOW = ['#ff4fa3', '#ffcf4a', '#7dff8a', '#4ae3ff', '#8b6bff']
const FOIL = ['#ff9fd0', '#ffe48a', '#a8f7b4', '#93e6ff', '#c2acff']
const PASTEL = ['#ffc2e2', '#fff0b8', '#c9ffd0', '#bff4ff', '#d8ccff']

const glare = (strength: number, reach = 0.55): Fill => ({
  kind: 'radial',
  stops: [
    [`rgba(255, 255, 255, ${strength})`, 0],
    [`rgba(255, 255, 255, ${strength * 0.35})`, reach * 0.45],
    ['rgba(255, 255, 255, 0)', reach],
  ],
  travel: 0.8,
})

export const EFFECT_INFO: Record<StickerEffect, EffectInfo> = {
  none: { name: 'None', tone: [], layers: [] },
  holo: {
    name: 'Holo',
    tone: [['saturate', 1.1]],
    layers: [
      // Tints the white border into rainbow foil; the picture keeps most of its color.
      { fills: [{ kind: 'linear', angle: 115, stops: bands(FOIL, 5), size: 3, travel: 1 }], blend: 'multiply', opacity: 0.85 },
      { fills: [{ kind: 'linear', angle: 115, stops: bands(RAINBOW, 5), size: 3, travel: 1 }], blend: 'color-dodge', opacity: 0.45 },
      { fills: [glare(0.75)], blend: 'overlay', opacity: 1 },
    ],
  },
  chrome: {
    name: 'Chrome',
    tone: [
      ['grayscale', 1],
      ['contrast', 1.3],
      ['brightness', 1.05],
    ],
    layers: [
      {
        fills: [
          {
            kind: 'linear',
            angle: 135,
            stops: [
              ['#ffffff', 0],
              ['#3c4250', 0.14],
              ['#f4f7ff', 0.27],
              ['#7d8494', 0.4],
              ['#ffffff', 0.5],
              ['#30353f', 0.64],
              ['#e9eef7', 0.78],
              ['#5d6370', 0.9],
              ['#ffffff', 1],
            ],
            size: 3,
            travel: 1,
          },
        ],
        blend: 'overlay',
        opacity: 0.85,
      },
      // A cool steel tint.
      { fills: [{ kind: 'linear', angle: 180, stops: [['#dfe9ff', 0], ['#eef2f8', 1]], size: 1, travel: 0 }], blend: 'multiply', opacity: 1 },
      { fills: [glare(0.9, 0.45)], blend: 'soft-light', opacity: 1 },
    ],
  },
  gold: {
    name: 'Gold',
    // Brightened gray first, so the foil stays bright where the multiply tints it.
    tone: [
      ['grayscale', 1],
      ['contrast', 0.7],
      ['brightness', 1.5],
    ],
    layers: [
      {
        fills: [
          {
            kind: 'linear',
            angle: 135,
            stops: [
              ['#fff6d6', 0],
              ['#d29a35', 0.15],
              ['#ffe596', 0.29],
              ['#e0ac48', 0.42],
              ['#fff4cc', 0.52],
              ['#c48a2a', 0.66],
              ['#ffdf86', 0.8],
              ['#d9a240', 0.92],
              ['#fff6d6', 1],
            ],
            size: 3,
            travel: 1,
          },
        ],
        blend: 'multiply',
        opacity: 1,
      },
      { fills: [glare(0.85, 0.5)], blend: 'overlay', opacity: 1 },
    ],
  },
  glitter: {
    name: 'Glitter',
    tone: [
      ['saturate', 1.15],
      ['contrast', 1.05],
    ],
    layers: [
      { fills: [{ kind: 'linear', angle: 115, stops: bands(PASTEL, 4), size: 3, travel: 0.6 }], blend: 'multiply', opacity: 0.35 },
      // Sparkles only catch the light near the glare, so different ones flash as it moves.
      {
        fills: [glare(1, 0.7), { kind: 'texture', texture: 'sparkle', tile: 96, travel: 14 }],
        fillBlend: 'multiply',
        blend: 'color-dodge',
        opacity: 1,
      },
      {
        fills: [glare(1, 0.9), { kind: 'texture', texture: 'sparkle2', tile: 72, travel: -10 }],
        fillBlend: 'multiply',
        blend: 'screen',
        opacity: 0.9,
      },
    ],
  },
  glossy: {
    name: 'Glossy',
    tone: [
      ['saturate', 1.15],
      ['contrast', 1.06],
    ],
    layers: [
      {
        fills: [
          {
            kind: 'linear',
            angle: 120,
            stops: [
              ['rgba(255, 255, 255, 0)', 0.36],
              ['rgba(255, 255, 255, 0.55)', 0.45],
              ['rgba(255, 255, 255, 0.15)', 0.5],
              ['rgba(255, 255, 255, 0)', 0.58],
            ],
            size: 2.5,
            travel: 1,
          },
        ],
        blend: 'screen',
        opacity: 1,
      },
      { fills: [glare(0.6, 0.5)], blend: 'soft-light', opacity: 1 },
    ],
  },
  matte: {
    name: 'Matte',
    tone: [
      ['saturate', 0.82],
      ['contrast', 0.9],
      ['brightness', 1.04],
    ],
    layers: [{ fills: [{ kind: 'texture', texture: 'grain', tile: 128, travel: 0 }], blend: 'soft-light', opacity: 0.55 }],
  },
}

/** A stored effect, or 'none' for stickers saved before effects existed (or anything unknown). */
export function effectOf(value: unknown): StickerEffect {
  return typeof value === 'string' && (EFFECTS as string[]).includes(value) ? (value as StickerEffect) : 'none'
}

/** Whether the effect changes with the light at all. */
export const isAnimated = (effect: StickerEffect) =>
  EFFECT_INFO[effect].layers.some((layer) => layer.fills.some((fill) => fill.travel !== 0))

// Tone: CSS filter functions, and the same math for baking images.

export function toneCss(tone: ToneOp[]): string {
  return tone.map(([op, amount]) => (op === 'hue-rotate' ? `hue-rotate(${amount}deg)` : `${op}(${amount})`)).join(' ')
}

type Matrix = [number, number, number, number, number, number, number, number, number]

const LUMA = [0.2126, 0.7152, 0.0722]

/** The 3×3 color matrix (plus offset) for a CSS filter function, from the Filter Effects spec. */
export function toneMatrix([op, amount]: ToneOp): { m: Matrix; offset: number } {
  const identity: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  switch (op) {
    case 'brightness':
      return { m: [amount, 0, 0, 0, amount, 0, 0, 0, amount], offset: 0 }
    case 'contrast':
      return { m: [amount, 0, 0, 0, amount, 0, 0, 0, amount], offset: 0.5 - 0.5 * amount }
    case 'grayscale':
    case 'saturate': {
      const s = op === 'grayscale' ? 1 - Math.min(1, amount) : amount
      const [r, g, b] = LUMA
      return {
        m: [r + (1 - r) * s, g - g * s, b - b * s, r - r * s, g + (1 - g) * s, b - b * s, r - r * s, g - g * s, b + (1 - b) * s],
        offset: 0,
      }
    }
    case 'sepia': {
      const k = 1 - Math.min(1, amount)
      return {
        m: [
          0.393 + 0.607 * k,
          0.769 - 0.769 * k,
          0.189 - 0.189 * k,
          0.349 - 0.349 * k,
          0.686 + 0.314 * k,
          0.168 - 0.168 * k,
          0.272 - 0.272 * k,
          0.534 - 0.534 * k,
          0.131 + 0.869 * k,
        ],
        offset: 0,
      }
    }
    case 'hue-rotate': {
      const a = (amount * Math.PI) / 180
      const c = Math.cos(a)
      const s = Math.sin(a)
      return {
        m: [
          0.213 + c * 0.787 - s * 0.213,
          0.715 - c * 0.715 - s * 0.715,
          0.072 - c * 0.072 + s * 0.928,
          0.213 - c * 0.213 + s * 0.143,
          0.715 + c * 0.285 + s * 0.14,
          0.072 - c * 0.072 - s * 0.283,
          0.213 - c * 0.213 - s * 0.787,
          0.715 - c * 0.715 + s * 0.715,
          0.072 + c * 0.928 + s * 0.072,
        ],
        offset: 0,
      }
    }
    default:
      return { m: identity, offset: 0 }
  }
}

/** Applies `tone` to RGBA pixels in place, clamping after each step the way CSS filter chains do. */
export function applyTone(pixels: Uint8ClampedArray, tone: ToneOp[]) {
  if (!tone.length) return
  const steps = tone.map(toneMatrix)
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue
    let r = pixels[i] / 255
    let g = pixels[i + 1] / 255
    let b = pixels[i + 2] / 255
    for (const { m, offset } of steps) {
      const nr = m[0] * r + m[1] * g + m[2] * b + offset
      const ng = m[3] * r + m[4] * g + m[5] * b + offset
      const nb = m[6] * r + m[7] * g + m[8] * b + offset
      r = Math.min(1, Math.max(0, nr))
      g = Math.min(1, Math.max(0, ng))
      b = Math.min(1, Math.max(0, nb))
    }
    pixels[i] = Math.round(r * 255)
    pixels[i + 1] = Math.round(g * 255)
    pixels[i + 2] = Math.round(b * 255)
  }
}

// Layers as CSS. With `light` the positions are fixed; without, they follow the --fx-x/--fx-y
// custom properties that lib/light.ts keeps up to date.

const round = (v: number) => Math.round(v * 1000) / 1000

function shift(axis: 'x' | 'y', light: Light | undefined, base: number, scale: number, unit: '%' | 'px') {
  if (light) return `${round(base + light[axis] * scale)}${unit}`
  if (scale === 0) return `${base}${unit}`
  return `calc(${base}${unit} + var(--fx-${axis}, 0) * ${round(scale)}${unit})`
}

const stopsCss = (stops: Stop[]) => stops.map(([color, at]) => `${color} ${round(at * 100)}%`).join(', ')

export interface FillCss {
  image: string
  size: string
  position: string
  repeat: string
}

export function fillCss(fill: Fill, light?: Light): FillCss {
  switch (fill.kind) {
    case 'linear':
      return {
        image: `linear-gradient(${fill.angle}deg, ${stopsCss(fill.stops)})`,
        size: `${fill.size * 100}% ${fill.size * 100}%`,
        position: `${shift('x', light, 50, fill.travel * 50, '%')} ${shift('y', light, 50, fill.travel * 50, '%')}`,
        repeat: 'no-repeat',
      }
    case 'radial':
      return {
        image: `radial-gradient(circle farthest-corner at ${shift('x', light, 50, fill.travel * 50, '%')} ${shift('y', light, 50, fill.travel * 50, '%')}, ${stopsCss(fill.stops)})`,
        size: '100% 100%',
        position: '0 0',
        repeat: 'no-repeat',
      }
    case 'texture':
      return {
        image: `var(--fx-${fill.texture})`,
        size: `${fill.tile}px ${fill.tile}px`,
        position: `${shift('x', light, 0, fill.travel, 'px')} ${shift('y', light, 0, fill.travel, 'px')}`,
        repeat: 'repeat',
      }
  }
}

export interface LayerStyle {
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
  backgroundRepeat: string
  backgroundBlendMode?: string
  mixBlendMode: Blend
  opacity: number
}

export function layerStyle(layer: Layer, light?: Light): LayerStyle {
  const fills = layer.fills.map((fill) => fillCss(fill, light))
  return {
    backgroundImage: fills.map((f) => f.image).join(', '),
    backgroundSize: fills.map((f) => f.size).join(', '),
    backgroundPosition: fills.map((f) => f.position).join(', '),
    backgroundRepeat: fills.map((f) => f.repeat).join(', '),
    ...(layer.fillBlend && { backgroundBlendMode: fills.map(() => layer.fillBlend).join(', ') }),
    mixBlendMode: layer.blend,
    opacity: layer.opacity,
  }
}

// Geometry shared with the canvas renderer, matching how CSS lays backgrounds out.

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Start and end of a CSS linear-gradient's line for `angle` (0deg = upwards, clockwise) in `box`. */
export function gradientLine(angle: number, box: Box) {
  const a = (angle * Math.PI) / 180
  const dx = Math.sin(a)
  const dy = -Math.cos(a)
  const half = (Math.abs(box.width * dx) + Math.abs(box.height * dy)) / 2
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half }
}

/**
 * Where a background `size` times the element's size lands for a background-position of `p`
 * (0…1), the way CSS percentages work: the p-point of the image sits on the p-point of the box.
 */
export function backgroundBox(width: number, height: number, size: number, px: number, py: number): Box {
  const w = width * size
  const h = height * size
  return { x: (width - w) * px, y: (height - h) * py, width: w, height: h }
}

/** Distance from (x, y) to the farthest corner of a width×height box. */
export function farthestCorner(x: number, y: number, width: number, height: number) {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y))
}
