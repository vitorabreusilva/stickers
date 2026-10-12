// Messages between the page and the sticker analysis worker.

import type { StickerAnalysis } from './topics'

export interface AnalysisRequest {
  id: number
  /** The sticker PNG. */
  image: Blob
}

export type AnalysisReply =
  | { id: number; type: 'result'; analysis: StickerAnalysis }
  | { id: number; type: 'error'; message: string }
