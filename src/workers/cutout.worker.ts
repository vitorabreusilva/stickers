// Runs the background-removal model off the main thread so the UI stays responsive.

import { InteractiveSegmenter, type BrushMode } from '@mediapipe/tasks-vision'
import type { CutoutReply, CutoutRequest } from '../lib/cutout-protocol'
import { refineMask } from '../lib/mask'
import { fetchAsset, modelUrl, pruneAssets, visionRuntime } from './vision-runtime'

declare const self: DedicatedWorkerGlobalScope

// BrushMode only exists as a type in the published bundle. POSITIVE marks a point on the object,
// LASSO says "the object inside this loop".
const POSITIVE = 1 as BrushMode
const LASSO = 3 as BrushMode
// A mask covering nearly everything means the model picked the background, not a subject.
const MAX_COVERAGE = 0.9

type Delegate = 'GPU' | 'CPU'

interface Engine {
  task: InteractiveSegmenter
  delegate: Delegate
  create: (delegate: Delegate) => Promise<InteractiveSegmenter>
}

let segmenter: Promise<Engine> | null = null
let downloaded = 0
const listeners = new Set<(fraction: number) => void>()

const post = (reply: CutoutReply, transfer: Transferable[] = []) => self.postMessage(reply, transfer)

function progress(bytes: number) {
  downloaded += bytes
  const fraction = __CUTOUT_BYTES__ > 0 ? Math.min(0.99, downloaded / __CUTOUT_BYTES__) : 0
  listeners.forEach((listener) => listener(fraction))
}

/** Software WebGL is far slower than the CPU path, so only use the GPU when it's a real one. */
function hasRealGpu(): boolean {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2')
    if (!gl) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)
  } catch {
    return false
  }
}

function loadSegmenter() {
  segmenter ??= (async (): Promise<Engine> => {
    const [, model] = await Promise.all([visionRuntime(progress), fetchAsset(modelUrl('cutout'), progress)])
    pruneAssets().catch(() => {})
    const create = async (delegate: Delegate) =>
      InteractiveSegmenter.createFromOptions(await visionRuntime(), {
        baseOptions: { modelAssetBuffer: model, delegate },
      })

    if (hasRealGpu()) {
      try {
        return { task: await create('GPU'), delegate: 'GPU', create }
      } catch (err) {
        console.warn('GPU cutout unavailable, using CPU', err)
      }
    }
    return { task: await create('CPU'), delegate: 'CPU', create }
  })()
  segmenter.catch(() => {
    segmenter = null
    downloaded = 0
  })
  return segmenter
}

function runStroke(task: InteractiveSegmenter, brushMode: BrushMode, point: { x: number; y: number }[]) {
  const mask = task.segment([{ brushMode, point, isCompleted: true }])
  try {
    const confidence = mask.hasFloat32Array()
      ? mask.getAsFloat32Array()
      : Float32Array.from(mask.getAsUint8Array(), (v) => v / 255)
    const refined = refineMask(confidence, mask.width, mask.height)
    return refined && { ...refined, width: mask.width, height: mask.height }
  } finally {
    mask.close()
  }
}

/** Null if the model came back empty, which on a working engine never happens for a loop. */
function cut(task: InteractiveSegmenter, request: Extract<CutoutRequest, { type: 'segment' }>) {
  task.setImage(request.image)
  const lasso = runStroke(task, LASSO, request.points)
  if (!lasso) return null
  if (lasso.coverage < MAX_COVERAGE) return { mask: lasso }
  // A loose loop on a plain background selects the background, which spans the whole picture.
  // Ask for the thing in the middle of the loop instead.
  const point = runStroke(task, POSITIVE, [request.center])
  return { mask: point && point.coverage < MAX_COVERAGE ? point : null }
}

self.onmessage = async ({ data: request }: MessageEvent<CutoutRequest>) => {
  const { id } = request
  const onProgress = (fraction: number) => post({ id, type: 'download', fraction })
  listeners.add(onProgress)
  try {
    const engine = await loadSegmenter()
    listeners.delete(onProgress)
    if (request.type === 'preload') {
      post({ id, type: 'result', mask: null })
      return
    }

    post({ id, type: 'cutting' })
    let outcome = cut(engine.task, request)
    if (!outcome && engine.delegate === 'GPU') {
      // Some mobile GPUs return empty masks; switch to the CPU for the rest of the session.
      const cpu = await engine.create('CPU')
      engine.task.close()
      engine.task = cpu
      engine.delegate = 'CPU'
      outcome = cut(engine.task, request)
    }
    const refined = outcome?.mask
    if (!refined) {
      post({ id, type: 'result', mask: null })
      return
    }
    post(
      {
        id,
        type: 'result',
        mask: { alpha: refined.alpha, bounds: refined.bounds, width: refined.width, height: refined.height },
      },
      [refined.alpha.buffer],
    )
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    listeners.delete(onProgress)
  }
}
