// Turns a line drawing (from the AI) into crisp print-ready line art: pure black lines, no grey
// shading, cropped to the drawing and enlarged to fill the page. Pure pixel operations, so they run
// in tests.

import { resizeBicubic } from './coloring'

// Greys lighter than this are paper; darker than BLACK is full ink. In between is anti-aliasing.
const PAPER = 225
const BLACK = 90

/** How much ink each pixel holds, 0 (paper) to 1 (black), laid over white. */
export function inkLevels(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const ink = new Float32Array(width * height)
  for (let i = 0; i < ink.length; i++) {
    const a = rgba[i * 4 + 3] / 255
    const grey = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a)
    ink[i] = Math.min(1, Math.max(0, (PAPER - grey) / (PAPER - BLACK)))
  }
  return ink
}

/**
 * Cleans a line drawing and fits it into `boxWidth` × `boxHeight`: light greys (shading, paper
 * texture) drop out, edges are sharpened after enlarging so lines stay crisp, and stray specks
 * are ignored when cropping. Returns black-on-transparent pixels like renderLines.
 */
export function cleanLineArt(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
) {
  const ink = inkLevels(rgba, width, height)

  // Crop to the drawing: rows and columns with a meaningful amount of ink.
  const threshold = 0.5
  const minRun = Math.max(2, Math.round(Math.max(width, height) / 400))
  const cols = new Int32Array(width)
  const rows = new Int32Array(height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x] < threshold) continue
      cols[x]++
      rows[y]++
    }
  }
  const first = (counts: Int32Array) => counts.findIndex((n) => n >= minRun)
  const last = (counts: Int32Array) => counts.length - 1 - [...counts].reverse().findIndex((n) => n >= minRun)
  let x0 = first(cols)
  let y0 = first(rows)
  if (x0 < 0 || y0 < 0) return { pixels: new Uint8ClampedArray(4), width: 1, height: 1 }
  let x1 = last(cols)
  let y1 = last(rows)
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.01) + 2
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad)
  y1 = Math.min(height - 1, y1 + pad)
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1

  // Ink as a grey picture, cropped, enlarged smoothly, then its edges tightened.
  const crop = new Uint8ClampedArray(cw * ch * 4)
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const v = Math.round(ink[(y + y0) * width + x + x0] * 255)
      crop.set([v, v, v, 255], (y * cw + x) * 4)
    }
  }
  const scale = Math.min(boxWidth / cw, boxHeight / ch)
  const outWidth = Math.max(1, Math.round(cw * scale))
  const outHeight = Math.max(1, Math.round(ch * scale))
  const big = scale === 1 ? crop : resizeBicubic(crop, cw, ch, outWidth, outHeight)
  // A steep curve around the middle: crisp edges that keep about a pixel of anti-aliasing.
  const soft = Math.min(0.25, 0.5 / Math.max(1, scale))
  const pixels = new Uint8ClampedArray(outWidth * outHeight * 4)
  for (let i = 0; i < outWidth * outHeight; i++) {
    const t = Math.min(1, Math.max(0, (big[i * 4] / 255 - (0.5 - soft)) / (2 * soft)))
    pixels[i * 4 + 3] = Math.round(t * t * (3 - 2 * t) * 255)
  }
  return { pixels, width: outWidth, height: outHeight }
}
