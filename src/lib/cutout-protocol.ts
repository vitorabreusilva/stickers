// Messages between the page and the background-removal worker.

import type { Rect } from './geometry'

export type CutoutRequest =
  | { id: number; type: 'preload' }
  | {
      id: number
      type: 'segment'
      image: ImageData
      /** The user's loop, normalized to 0..1 within `image`. */
      points: { x: number; y: number }[]
      /** The middle of the loop, normalized: a fallback prompt when the loop alone is ambiguous. */
      center: { x: number; y: number }
    }

export interface WorkerMask {
  /** Opacity 0..1 per pixel of the segmented image. */
  alpha: Float32Array<ArrayBuffer>
  width: number
  height: number
  /** Where the subject is, in mask pixels. */
  bounds: Rect
}

export type CutoutReply =
  | { id: number; type: 'download'; fraction: number }
  | { id: number; type: 'cutting' }
  | { id: number; type: 'result'; mask: WorkerMask | null }
  | { id: number; type: 'error'; message: string }
