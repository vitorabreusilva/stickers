import type { TextureName } from './effects'

/** A small, seedable PRNG (mulberry32) so textures look the same on every load. */
export function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Sparkle {
  x: number
  y: number
  radius: number
  color: string
  /** 0…1 */
  brightness: number
}

const SPARKLE_COLORS = ['#ffffff', '#ffffff', '#fff1b3', '#bff6ff', '#ffc4ec', '#d6c8ff']

/** Glitter flakes scattered over a `size`×`size` tile. */
export function sparkles(seed: number, count: number, size: number): Sparkle[] {
  const next = random(seed)
  return Array.from({ length: count }, () => ({
    x: next() * size,
    y: next() * size,
    radius: 0.5 + next() ** 3 * 1.6,
    color: SPARKLE_COLORS[Math.floor(next() * SPARKLE_COLORS.length)],
    brightness: 0.35 + next() * 0.65,
  }))
}

/** Mid-gray paper grain, as RGBA pixels: neutral under soft-light, so only the grain shows. */
export function grain(seed: number, size: number): Uint8ClampedArray<ArrayBuffer> {
  const next = random(seed)
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    const v = 128 + (next() + next() - 1) * 70
    pixels[i] = pixels[i + 1] = pixels[i + 2] = v
    pixels[i + 3] = 255
  }
  return pixels
}

const TILE = 192

function drawSparkles(canvas: HTMLCanvasElement, seed: number, count: number) {
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, TILE, TILE)
  for (const s of sparkles(seed, count, TILE)) {
    ctx.globalAlpha = s.brightness
    ctx.fillStyle = s.color
    // Drawn at each wrapped position so flakes on the edge tile seamlessly.
    for (const dx of [-TILE, 0, TILE])
      for (const dy of [-TILE, 0, TILE]) {
        ctx.beginPath()
        ctx.arc(s.x + dx, s.y + dy, s.radius, 0, Math.PI * 2)
        ctx.fill()
      }
    if (s.radius > 1.4) {
      // The biggest flakes get a little four-point glint.
      ctx.globalAlpha = s.brightness * 0.6
      ctx.fillRect(s.x - s.radius * 3, s.y - 0.5, s.radius * 6, 1)
      ctx.fillRect(s.x - 0.5, s.y - s.radius * 3, 1, s.radius * 6)
    }
  }
  ctx.globalAlpha = 1
}

const canvases = new Map<TextureName, HTMLCanvasElement>()

/** A tile of the texture, drawn on first use. */
export function textureCanvas(name: TextureName): HTMLCanvasElement {
  let canvas = canvases.get(name)
  if (canvas) return canvas
  canvas = document.createElement('canvas')
  canvas.width = canvas.height = TILE
  if (name === 'grain') {
    canvas.getContext('2d')!.putImageData(new ImageData(grain(7, TILE), TILE, TILE), 0, 0)
  } else {
    drawSparkles(canvas, name === 'sparkle' ? 1 : 2, name === 'sparkle' ? 260 : 180)
  }
  canvases.set(name, canvas)
  return canvas
}

let installed = false

/** Exposes the textures to CSS as --fx-sparkle, --fx-sparkle2 and --fx-grain. */
export function installTextures() {
  if (installed) return
  installed = true
  for (const name of ['sparkle', 'sparkle2', 'grain'] as TextureName[]) {
    document.documentElement.style.setProperty(`--fx-${name}`, `url(${textureCanvas(name).toDataURL()})`)
  }
}
