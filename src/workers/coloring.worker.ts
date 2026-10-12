// Traces coloring-page line art off the main thread (a second or two per sticker), and tidies AI
// drawings for print.

import { lineBounds, renderLines, traceLines } from '../lib/coloring'
import type { ColoringReply, ColoringRequest } from '../lib/coloring-protocol'
import { cleanLineArt } from '../lib/line-art'

declare const self: DedicatedWorkerGlobalScope

function trace(request: Extract<ColoringRequest, { type: 'trace' }>) {
  const { image, detail, width, height, style } = request
  const fields = traceLines(image.data, image.width, image.height, detail)
  // Crop to the drawing, leaving room for the outline's stroke, then fill the space on the page.
  let rect = lineBounds(fields, 0)
  const fit = Math.min(width / rect.width, height / rect.height)
  rect = lineBounds(fields, style.outline / fit / 2 + 1)
  const scale = Math.min(width / rect.width, height / rect.height)
  const outWidth = Math.max(1, Math.round(rect.width * scale))
  const outHeight = Math.max(1, Math.round(rect.height * scale))
  return { pixels: renderLines(fields, outWidth, outHeight, style, rect), width: outWidth, height: outHeight }
}

self.onmessage = ({ data }: MessageEvent<ColoringRequest>) => {
  try {
    const art =
      data.type === 'trace'
        ? trace(data)
        : cleanLineArt(data.image.data, data.image.width, data.image.height, data.width, data.height)
    const reply: ColoringReply = { id: data.id, type: 'result', ...art }
    self.postMessage(reply, [art.pixels.buffer])
  } catch (err) {
    const reply: ColoringReply = { id: data.id, type: 'error', message: err instanceof Error ? err.message : String(err) }
    self.postMessage(reply)
  }
}
