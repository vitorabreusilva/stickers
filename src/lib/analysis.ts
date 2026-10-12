// Page-side client for the sticker analysis worker.

import type { AnalysisReply } from './analysis-protocol'
import type { StickerAnalysis } from './topics'

let worker: Worker | null = null
let nextId = 1
const jobs = new Map<number, { resolve: (a: StickerAnalysis) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }: MessageEvent<AnalysisReply>) => {
    const job = jobs.get(data.id)
    if (!job) return
    jobs.delete(data.id)
    if (data.type === 'result') job.resolve(data.analysis)
    else job.reject(new Error(data.message))
  }
  w.onerror = (event) => {
    event.preventDefault()
    jobs.forEach((job) => job.reject(new Error(event.message || 'Analysis worker crashed')))
    jobs.clear()
    w.terminate()
    worker = null
  }
  worker = w
  return w
}

/** Works out what a sticker shows. The first call downloads the models (about 12 MB). */
export function analyzeSticker(image: Blob): Promise<StickerAnalysis> {
  return new Promise((resolve, reject) => {
    const id = nextId++
    jobs.set(id, { resolve, reject })
    getWorker().postMessage({ id, image })
  })
}
