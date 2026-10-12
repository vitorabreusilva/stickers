// Worker-side plumbing shared by the MediaPipe workers: downloading and caching the runtime and
// models, and booting the wasm runtime from inside a module worker.

import wasmLoaderSource from '@mediapipe/tasks-vision/vision_wasm_internal.js?raw'
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

declare const self: DedicatedWorkerGlobalScope & { ModuleFactory?: unknown }

/** Where MediaPipe finds its runtime (the package doesn't export this type). */
export interface WasmFileset {
  wasmLoaderPath: string
  wasmBinaryPath: string
}

const ASSET_CACHE = 'vision-assets'
// Earlier releases cached the cutout model here.
const OLD_CACHES = ['cutout-assets']

const WASM_URL = new URL(wasmBinaryUrl, self.location.origin).href

/** Absolute URL of one of the models in scripts/models.json. */
export function modelUrl(role: keyof typeof __MODELS__): string {
  return new URL(`${import.meta.env.BASE_URL}${__MODELS__[role]}`, self.location.origin).href
}

/** Fetches a file once and keeps it in Cache Storage, so later sessions (and offline use) skip the download. */
export async function fetchAsset(url: string, onBytes?: (bytes: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const cache = await caches.open(ASSET_CACHE).catch(() => null)
  const cached = await cache?.match(url)
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer())
    onBytes?.(bytes.byteLength)
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
    onBytes?.(value.byteLength)
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

/** Drops cached files that no current model or runtime uses any more. */
export async function pruneAssets() {
  const keep = new Set([WASM_URL, ...(Object.keys(__MODELS__) as (keyof typeof __MODELS__)[]).map(modelUrl)])
  for (const name of OLD_CACHES) await caches.delete(name)
  const cache = await caches.open(ASSET_CACHE)
  for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request)
}

let wasmPath: Promise<string> | null = null

/**
 * The wasm runtime for creating a MediaPipe task. Call right before each `createFromOptions`:
 * MediaPipe's loader is a classic script that sets a global `ModuleFactory`, which module workers
 * can't importScripts(), so it's evaluated here (MediaPipe skips loading it when given no path),
 * and MediaPipe clears that global after every task it creates.
 */
export async function visionRuntime(onBytes?: (bytes: number) => void): Promise<WasmFileset> {
  wasmPath ??= fetchAsset(WASM_URL, onBytes).then((wasm) =>
    URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })),
  )
  wasmPath.catch(() => (wasmPath = null))
  const wasmBinaryPath = await wasmPath
  self.ModuleFactory = new Function(`${wasmLoaderSource}\nreturn ModuleFactory`)()
  return { wasmLoaderPath: '', wasmBinaryPath }
}
