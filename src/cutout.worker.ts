// Runs the background-removal model off the main thread so the UI stays responsive.

import { InteractiveSegmenter, type BrushMode } from '@mediapipe/tasks-vision'
import wasmLoaderSource from '@mediapipe/tasks-vision/vision_wasm_internal.js?raw'
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import type { CutoutReply, CutoutRequest } from './lib/cutout-protocol'
import { refineMask } from './lib/mask'

declare const self: DedicatedWorkerGlobalScope & { ModuleFactory?: unknown }

// BrushMode only exists as a type in the published bundle. POSITIVE marks a point on the object,
// LASSO says "the object inside this loop".
const POSITIVE = 1 as BrushMode
const LASSO = 3 as BrushMode
// A mask covering nearly everything means the model picked the background, not a subject.
const MAX_COVERAGE = 0.9
const MODEL_URL = new URL(`${import.meta.env.BASE_URL}${__CUTOUT_MODEL__}`, self.location.origin).href
const WASM_URL = new URL(wasmBinaryUrl, self.location.origin).href
const ASSET_CACHE = 'cutout-assets'

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

/** Fetches a file once and keeps it in Cache Storage, so later sessions (and offline use) skip the download. */
async function fetchAsset(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const cache = await caches.open(ASSET_CACHE).catch(() => null)
  const cached = await cache?.match(url)
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer())
    progress(bytes.byteLength)
    return bytes
  }

  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    progress(value.byteLength)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  await cache?.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {})
  return bytes
}

function progress(bytes: number) {
  downloaded += bytes
  const fraction = __CUTOUT_BYTES__ > 0 ? Math.min(0.99, downloaded / __CUTOUT_BYTES__) : 0
  listeners.forEach((listener) => listener(fraction))
}

/** Drops cached copies of older model/runtime versions. */
async function pruneCache() {
  const cache = await caches.open(ASSET_CACHE)
  for (const request of await cache.keys()) {
    if (request.url !== MODEL_URL && request.url !== WASM_URL) await cache.delete(request)
  }
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

/**
 * MediaPipe's wasm loader is a classic script that defines a global `ModuleFactory`. Module workers
 * can't importScripts() it, so evaluate it here; MediaPipe then skips loading it when given no path.
 * It clears the global after each use, so this runs before every task creation.
 */
function installModuleFactory() {
  self.ModuleFactory = new Function(`${wasmLoaderSource}\nreturn ModuleFactory`)()
}

function loadSegmenter() {
  segmenter ??= (async (): Promise<Engine> => {
    const [wasm, model] = await Promise.all([fetchAsset(WASM_URL), fetchAsset(MODEL_URL)])
    pruneCache().catch(() => {})
    const wasmBinaryPath = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }))
    const create = (delegate: Delegate) => {
      installModuleFactory()
      return InteractiveSegmenter.createFromOptions(
        { wasmLoaderPath: '', wasmBinaryPath },
        { baseOptions: { modelAssetBuffer: model, delegate } },
      )
    }

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
