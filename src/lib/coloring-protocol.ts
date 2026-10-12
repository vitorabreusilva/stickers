// Messages between the page and the coloring worker.

import type { ColoringDetail, LineStyle } from './coloring'

export type ColoringRequest =
  | {
      id: number
      type: 'trace'
      /** The sticker's pixels. */
      image: ImageData
      detail: ColoringDetail
      /** Room for the drawing on the page, in print pixels. It's fitted inside, keeping proportions. */
      width: number
      height: number
      style: LineStyle
    }
  | {
      id: number
      /** Tidies a finished line drawing (from the AI) for print. */
      type: 'clean'
      image: ImageData
      width: number
      height: number
    }

export type ColoringReply =
  | { id: number; type: 'result'; pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number }
  | { id: number; type: 'error'; message: string }
