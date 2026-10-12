// Background removal: finds the subject inside the user's loop with an on-device model.

import type { CutoutReply, CutoutRequest, WorkerMask } from './cutout-protocol'
import { boundingBox, intersectRect, polygonCentroid, type Point, type Rect } from './geometry'
import { createCanvas, type LoadedImage } from './image'

export interface SubjectMask extends WorkerMask {
  /** The part of the picture, in image pixels, that the mask covers. */
  rect: Rect
}

export type CutoutStatus = { stage: 'download'; fraction: number } | { stage: 'cutting' }

// The model runs at a fixed internal resolution, so bigger inputs only cost memory.
const MAX_INPUT = 1024
// How far past the loop the model may look, relative to the loop's size. Quick loops often clip the subject.
const CONTEXT = 0.5
// The loop is sent as a stroke; more points than this adds nothing.
const MAX_LOOP_POINTS = 256

const PREF_KEY = 'stickers.removeBackground'

export function cutoutPreferred(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setCutoutPreferred(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    // Not remembering the choice is fine.
  }
}

interface Job {
  resolve: (mask: WorkerMask | null) => void
  reject: (err: Error) => void
  onStatus?: (status: CutoutStatus) => void
}

let worker: Worker | null = null
let nextId = 1
const jobs = new Map<number, Job>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('../workers/cutout.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }: MessageEvent<CutoutReply>) => {
    const job = jobs.get(data.id)
    if (!job) return
    if (data.type === 'download') job.onStatus?.({ stage: 'download', fraction: data.fraction })
    else if (data.type === 'cutting') job.onStatus?.({ stage: 'cutting' })
    else {
      jobs.delete(data.id)
      if (data.type === 'result') job.resolve(data.mask)
      else job.reject(new Error(data.message))
    }
  }
  w.onerror = (event) => {
    // The worker died (e.g. ran out of memory): fail what's pending and start fresh next time.
    event.preventDefault()
    jobs.forEach((job) => job.reject(new Error(event.message || 'Cutout worker crashed')))
    jobs.clear()
    w.terminate()
    worker = null
  }
  worker = w
  return w
}

function run(request: CutoutRequest, transfer: Transferable[], onStatus?: Job['onStatus']) {
  return new Promise<WorkerMask | null>((resolve, reject) => {
    jobs.set(request.id, { resolve, reject, onStatus })
    getWorker().postMessage(request, transfer)
  })
}

/** Starts downloading and warming up the model, so it's ready by the time the user finishes drawing. */
export function preloadCutout() {
  run({ id: nextId++, type: 'preload' }, []).catch((err) => console.warn('Cutout preload failed', err))
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Finds the subject the user drew a loop around. Resolves null if there's no clear subject. */
export async function findSubject(
  image: LoadedImage,
  loop: Point[],
  onStatus?: (status: CutoutStatus) => void,
): Promise<SubjectMask | null> {
  const box = boundingBox(loop)
  const rect = intersectRect(
    {
      x: box.x - box.width * CONTEXT,
      y: box.y - box.height * CONTEXT,
      width: box.width * (1 + 2 * CONTEXT),
      height: box.height * (1 + 2 * CONTEXT),
    },
    { x: 0, y: 0, width: image.width, height: image.height },
  )
  if (rect.width < 2 || rect.height < 2) return null

  const scale = Math.min(1, MAX_INPUT / Math.max(rect.width, rect.height))
  const width = Math.max(1, Math.round(rect.width * scale))
  const height = Math.max(1, Math.round(rect.height * scale))
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is not available')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image.source, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height)
  const pixels = ctx.getImageData(0, 0, width, height)

  const step = Math.max(1, Math.ceil(loop.length / MAX_LOOP_POINTS))
  const points = loop
    .filter((_, i) => i % step === 0)
    .map((p) => ({ x: clamp01((p.x - rect.x) / rect.width), y: clamp01((p.y - rect.y) / rect.height) }))

  const centroid = polygonCentroid(loop)
  const center = { x: clamp01((centroid.x - rect.x) / rect.width), y: clamp01((centroid.y - rect.y) / rect.height) }

  const mask = await run(
    { id: nextId++, type: 'segment', image: pixels, points, center },
    [pixels.data.buffer],
    onStatus,
  )
  return mask && { ...mask, rect }
}

export interface CutoutJob {
  promise: Promise<SubjectMask | null>
  /** Latest progress, for screens that start watching mid-way. */
  status: CutoutStatus
  /** Set once the job has finished successfully. */
  result?: { mask: SubjectMask | null }
  subscribe: (listener: (status: CutoutStatus) => void) => () => void
}

// One cutout per loop, so going back and forth in the UI doesn't redo the work.
const cutoutJobs = new WeakMap<Point[], CutoutJob>()

/** Starts (or joins) background removal for this loop. */
export function cutoutFor(image: LoadedImage, loop: Point[]): CutoutJob {
  const existing = cutoutJobs.get(loop)
  if (existing) return existing

  const listeners = new Set<(status: CutoutStatus) => void>()
  const job: CutoutJob = {
    status: { stage: 'cutting' },
    promise: findSubject(image, loop, (status) => {
      job.status = status
      listeners.forEach((listener) => listener(status))
    }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  job.promise.then(
    (mask) => (job.result = { mask }),
    () => cutoutJobs.delete(loop),
  )
  cutoutJobs.set(loop, job)
  return job
}
