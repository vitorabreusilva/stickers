// Messages between the page and the coloring worker.

import type { ColoringDetail, LineStyle } from './coloring'

export interface ColoringRequest {
  id: number
  /** The sticker's pixels. */
  image: ImageData
  detail: ColoringDetail
  /** Room for the drawing on the page, in print pixels. It's fitted inside, keeping proportions. */
  width: number
  height: number
  style: LineStyle
}

export type ColoringReply =
  | { id: number; type: 'result'; pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }
  | { id: number; type: 'error'; message: string }
