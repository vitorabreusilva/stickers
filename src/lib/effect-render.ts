import {
  applyTone,
  backgroundBox,
  EFFECT_INFO,
  farthestCorner,
  gradientLine,
  RESTING_LIGHT,
  type Blend,
  type Fill,
  type Light,
  type StickerEffect,
} from './effects'
import { canvasToBlob, createCanvas } from './image'
import { textureCanvas } from './textures'

// Texture tiles are sized in CSS pixels; this is roughly how wide a sticker shows up on screen.
const SCREEN_WIDTH = 360

const operation = (blend: Blend): GlobalCompositeOperation => (blend === 'normal' ? 'source-over' : blend)

function paintFill(ctx: CanvasRenderingContext2D, fill: Fill, light: Light, width: number, height: number) {
  ctx.save()
  switch (fill.kind) {
    case 'linear': {
      const p = (axis: 'x' | 'y') => 0.5 + light[axis] * fill.travel * 0.5
      const box = backgroundBox(width, height, fill.size, p('x'), p('y'))
      const { x0, y0, x1, y1 } = gradientLine(fill.angle, box)
      const gradient = ctx.createLinearGradient(x0, y0, x1, y1)
      for (const [color, at] of fill.stops) gradient.addColorStop(at, color)
      ctx.beginPath()
      ctx.rect(0, 0, width, height)
      ctx.clip()
      ctx.fillStyle = gradient
      ctx.fillRect(box.x, box.y, box.width, box.height)
      break
    }
    case 'radial': {
      const cx = width * (0.5 + light.x * fill.travel * 0.5)
      const cy = height * (0.5 + light.y * fill.travel * 0.5)
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, farthestCorner(cx, cy, width, height))
      for (const [color, at] of fill.stops) gradient.addColorStop(at, color)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
      break
    }
    case 'texture': {
      const tile = textureCanvas(fill.texture)
      const scale = ((fill.tile / tile.width) * width) / SCREEN_WIDTH
      const pattern = ctx.createPattern(tile, 'repeat')!
      const offset = (fill.travel * width) / SCREEN_WIDTH
      pattern.setTransform(new DOMMatrix().translate(light.x * offset, light.y * offset).scale(scale))
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, width, height)
      break
    }
  }
  ctx.restore()
}

/** Draws the sticker with `effect` frozen under `light`, mirroring how StickerArt shows it live. */
export function renderEffect(source: CanvasImageSource, width: number, height: number, effect: StickerEffect, light: Light) {
  const { tone, layers } = EFFECT_INFO[effect]
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, width, height)
  if (tone.length) {
    const pixels = ctx.getImageData(0, 0, width, height)
    applyTone(pixels.data, tone)
    ctx.putImageData(pixels, 0, 0)
  }

  for (const layer of layers) {
    const layerCanvas = createCanvas(width, height)
    const lctx = layerCanvas.getContext('2d')!
    // CSS backgrounds list the top one first.
    for (let i = layer.fills.length - 1; i >= 0; i--) {
      const bottom = i === layer.fills.length - 1
      lctx.globalCompositeOperation = !bottom && layer.fillBlend ? operation(layer.fillBlend) : 'source-over'
      paintFill(lctx, layer.fills[i], light, width, height)
    }
    // Masked to the sticker's shape.
    lctx.globalCompositeOperation = 'destination-in'
    lctx.drawImage(source, 0, 0, width, height)

    ctx.globalAlpha = layer.opacity
    ctx.globalCompositeOperation = operation(layer.blend)
    ctx.drawImage(layerCanvas, 0, 0)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  return canvas
}

/** The sticker as a PNG with its effect baked in, for sharing, copying and saving. */
export async function bakeEffect(blob: Blob, effect: StickerEffect, light = RESTING_LIGHT): Promise<Blob> {
  if (effect === 'none') return blob
  const bitmap = await createImageBitmap(blob)
  try {
    return await canvasToBlob(renderEffect(bitmap, bitmap.width, bitmap.height, effect, light))
  } finally {
    bitmap.close()
  }
}
