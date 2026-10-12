// Traces coloring-page line art off the main thread; it takes a second or so per sticker.

import { lineBounds, renderLines, traceLines } from '../lib/coloring'
import type { ColoringReply, ColoringRequest } from '../lib/coloring-protocol'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = ({ data }: MessageEvent<ColoringRequest>) => {
  const { id, image, detail, width, height, style } = data
  try {
    const fields = traceLines(image.data, image.width, image.height, detail)
    // Crop to the drawing, leaving room for the outline's stroke, then fill the space on the page.
    let rect = lineBounds(fields, 0)
    const fit = Math.min(width / rect.width, height / rect.height)
    rect = lineBounds(fields, style.outline / fit / 2 + 1)
    const scale = Math.min(width / rect.width, height / rect.height)
    const outWidth = Math.max(1, Math.round(rect.width * scale))
    const outHeight = Math.max(1, Math.round(rect.height * scale))
    const pixels = renderLines(fields, outWidth, outHeight, style, rect)
    const reply: ColoringReply = { id, type: 'result', pixels, width: outWidth, height: outHeight }
    self.postMessage(reply, [pixels.buffer])
  } catch (err) {
    const reply: ColoringReply = { id, type: 'error', message: err instanceof Error ? err.message : String(err) }
    self.postMessage(reply)
  }
}
