// Works out what a sticker shows (for grouping by topic) with small on-device models, off the
// main thread: an ImageNet classifier, a visual embedder and a face detector.

import { FaceDetector, ImageClassifier, ImageEmbedder } from '@mediapipe/tasks-vision'
import type { AnalysisReply, AnalysisRequest } from '../lib/analysis-protocol'
import { referenceDrawings } from '../lib/drawings'
import { ANALYSIS_VERSION, cosine, type StickerAnalysis } from '../lib/topics'
import { fetchAsset, modelUrl, visionRuntime } from './vision-runtime'

declare const self: DedicatedWorkerGlobalScope

// The models look at a square picture; this is plenty for "what is it".
const SIZE = 384
// Classes beyond the top few carry almost no probability.
const MAX_CLASSES = 20

interface Models {
  classifier: ImageClassifier
  embedder: ImageEmbedder
  faces: FaceDetector
  /** Average embedding of the reference cartoon drawings. */
  drawing: Float32Array
}

let models: Promise<Models> | null = null

function normalize(v: Float32Array) {
  const length = Math.hypot(...v) || 1
  for (let i = 0; i < v.length; i++) v[i] /= length
  return v
}

function loadModels() {
  models ??= (async (): Promise<Models> => {
    const [classifierModel, embedderModel, faceModel] = await Promise.all([
      fetchAsset(modelUrl('classifier')),
      fetchAsset(modelUrl('embedder')),
      fetchAsset(modelUrl('face')),
    ])
    // These models are small, so the CPU is fast enough and avoids GPU quirks.
    const classifier = await ImageClassifier.createFromOptions(await visionRuntime(), {
      baseOptions: { modelAssetBuffer: classifierModel, delegate: 'CPU' },
      maxResults: MAX_CLASSES,
    })
    const embedder = await ImageEmbedder.createFromOptions(await visionRuntime(), {
      baseOptions: { modelAssetBuffer: embedderModel, delegate: 'CPU' },
      l2Normalize: true,
    })
    const faces = await FaceDetector.createFromOptions(await visionRuntime(), {
      baseOptions: { modelAssetBuffer: faceModel, delegate: 'CPU' },
      minDetectionConfidence: 0.5,
    })

    let drawing: Float32Array | undefined
    for (const canvas of referenceDrawings(SIZE)) {
      const e = embedder.embed(canvas).embeddings[0].floatEmbedding ?? []
      drawing ??= new Float32Array(e.length)
      for (let i = 0; i < e.length; i++) drawing[i] += e[i]
    }
    return { classifier, embedder, faces, drawing: normalize(drawing!) }
  })()
  models.catch(() => (models = null))
  return models
}

/** The sticker on white, fitted into a square, the way the models (and the reference drawings) see it. */
async function prepare(image: Blob): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(image)
  const canvas = new OffscreenCanvas(SIZE, SIZE)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, SIZE, SIZE)
  const scale = (Math.min(SIZE / bitmap.width, SIZE / bitmap.height) * 0.92)
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  ctx.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
  bitmap.close()
  return canvas
}

const post = (reply: AnalysisReply, transfer: Transferable[] = []) => self.postMessage(reply, transfer)

self.onmessage = async ({ data: { id, image } }: MessageEvent<AnalysisRequest>) => {
  try {
    const { classifier, embedder, faces, drawing } = await loadModels()
    const canvas = await prepare(image)
    const classes = classifier
      .classify(canvas)
      .classifications[0].categories.map((c) => ({ index: c.index, name: c.categoryName, score: c.score }))
    const embedding = Float32Array.from(embedder.embed(canvas).embeddings[0].floatEmbedding ?? [])
    const face = Math.max(0, ...faces.detect(canvas).detections.map((d) => d.categories[0]?.score ?? 0))
    const analysis: StickerAnalysis = {
      version: ANALYSIS_VERSION,
      classes,
      face,
      drawn: cosine(embedding, drawing),
      embedding,
    }
    post({ id, type: 'result', analysis })
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
