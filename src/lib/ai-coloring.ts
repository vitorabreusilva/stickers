// Coloring pages drawn by an AI image model: the sticker goes in, clean line art comes out.
// Several models from four providers are offered, since each refuses or struggles with
// different pictures. When signed in, they're drawn through our server with the app's keys
// (Vercel environment variables, see SERVER_KEYS); otherwise with the person's own keys, kept
// on their device. The drawing code below runs in both places.

import type { ColoringDetail } from './coloring'

export type AiProvider = 'openai' | 'google' | 'fal' | 'quiver'
export type AiQuality = 'low' | 'medium' | 'high'
export const AI_QUALITIES: AiQuality[] = ['low', 'medium', 'high']

export const PROVIDERS: Record<AiProvider, { name: string; keyUrl: string; keyHint: string; note: string }> = {
  openai: {
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    note: 'Image models need a verified organization and some credit on the account.',
  },
  google: {
    name: 'Google',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza…',
    note: 'Image models need billing turned on for the key’s Google Cloud project.',
  },
  fal: {
    name: 'fal.ai',
    keyUrl: 'https://fal.ai/dashboard/keys',
    keyHint: 'key-id:secret',
    note: 'One key covers all the fal.ai models. Add some credit to the account first.',
  },
  quiver: {
    name: 'QuiverAI',
    keyUrl: 'https://quiver.ai',
    keyHint: 'Your QuiverAI API key',
    note: 'Sign in, then create a key under API keys. Arrow 2 is priced by how much drawing it produces.',
  },
}

/** The environment variable holding each provider's key on the server. */
export const SERVER_KEYS: Record<AiProvider, string> = {
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  fal: 'FAL_KEY',
  quiver: 'QUIVER_API_KEY',
}

export interface AiEngine {
  id: string
  provider: AiProvider
  name: string
  blurb: string
  /** Model or endpoint used unless the person types another in AI settings. */
  model: string
}

export const AI_ENGINES: AiEngine[] = [
  { id: 'openai', provider: 'openai', name: 'GPT Image', blurb: 'OpenAI. Very clean lines; strict about well-known characters.', model: 'gpt-image-1.5' },
  { id: 'gemini', provider: 'google', name: 'Nano Banana 2', blurb: 'Google Gemini. Faithful to the original drawing.', model: 'gemini-3.1-flash-image' },
  { id: 'kontext', provider: 'fal', name: 'FLUX Kontext Pro', blurb: 'Black Forest Labs, on fal.ai. Strong at turning pictures into line art.', model: 'fal-ai/flux-pro/kontext' },
  { id: 'seedream', provider: 'fal', name: 'Seedream 4', blurb: 'ByteDance, on fal.ai. Cheap and detailed.', model: 'fal-ai/bytedance/seedream/v4/edit' },
  { id: 'qwen', provider: 'fal', name: 'Qwen Image Edit', blurb: 'Alibaba, on fal.ai. Cheap; good at keeping shapes.', model: 'fal-ai/qwen-image-edit' },
  { id: 'quiver', provider: 'quiver', name: 'Arrow 2 (vector)', blurb: 'QuiverAI. Draws real vector lines, perfectly sharp at any size.', model: 'arrow-2' },
]

export const engineById = (id: string) => AI_ENGINES.find((e) => e.id === id) ?? AI_ENGINES[0]

/** Rough price per page in US dollars. OpenAI's depends on quality; the rest are flat. */
const PRICES: Record<string, number | Record<AiQuality, number>> = {
  'gpt-image-1.5': { low: 0.013, medium: 0.05, high: 0.2 },
  'gpt-image-1-mini': { low: 0.006, medium: 0.015, high: 0.052 },
  'gemini-3.1-flash-image': 0.067,
  'fal-ai/flux-pro/kontext': 0.04,
  'fal-ai/bytedance/seedream/v4/edit': 0.03,
  'fal-ai/qwen-image-edit': 0.03,
}

export interface AiSettings {
  engine: string
  keys: Record<AiProvider, string>
  /** Model names typed in to replace an engine's default. */
  models: Record<string, string>
  /** OpenAI only. */
  quality: AiQuality
  /** Where the server draws, and which providers it has keys for. Learned each time, never saved. */
  server?: AiServer
}

export interface AiServer {
  url: string
  providers: AiProvider[]
}

const STORE = 'stickers.ai'
// Where the first, OpenAI-only version kept its settings.
const OLD_KEY = 'stickers.ai.key'
const OLD_MODEL = 'stickers.ai.model'
const OLD_QUALITY = 'stickers.ai.quality'

export function loadAiSettings(): AiSettings {
  const read = (key: string) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const defaults: AiSettings = { engine: 'openai', keys: { openai: '', google: '', fal: '', quiver: '' }, models: {}, quality: 'medium' }
  try {
    const stored = JSON.parse(read(STORE) ?? 'null') as Partial<AiSettings> | null
    if (stored) {
      return {
        engine: engineById(stored.engine ?? '').id,
        keys: { ...defaults.keys, ...stored.keys },
        models: { ...stored.models },
        quality: AI_QUALITIES.includes(stored.quality as AiQuality) ? (stored.quality as AiQuality) : 'medium',
      }
    }
  } catch {
    // Fall back to the older settings or the defaults.
  }
  const quality = read(OLD_QUALITY) as AiQuality | null
  const model = read(OLD_MODEL)
  return {
    ...defaults,
    keys: { ...defaults.keys, openai: read(OLD_KEY) ?? '' },
    models: model && model !== AI_ENGINES[0].model ? { openai: model } : {},
    quality: quality && AI_QUALITIES.includes(quality) ? quality : 'medium',
  }
}

export function saveAiSettings(settings: AiSettings) {
  const { server: _server, ...rest } = settings
  const clean: AiSettings = {
    ...rest,
    keys: Object.fromEntries(Object.entries(settings.keys).map(([p, k]) => [p, k.trim()])) as AiSettings['keys'],
    models: Object.fromEntries(Object.entries(settings.models).filter(([, m]) => m.trim()).map(([id, m]) => [id, m.trim()])),
  }
  try {
    localStorage.setItem(STORE, JSON.stringify(clean))
    localStorage.removeItem(OLD_KEY)
    localStorage.removeItem(OLD_MODEL)
    localStorage.removeItem(OLD_QUALITY)
  } catch {
    // Without storage the settings only last this session.
  }
}

/** The model an engine will use with these settings. */
export const engineModel = (settings: AiSettings, engine: AiEngine) => settings.models[engine.id] || engine.model

/** Whether the server has a key for the engine's provider. */
export const onServer = (settings: AiSettings, engine: AiEngine) => !!settings.server?.providers.includes(engine.provider)

/** Whether the engine can draw: the server has a key for its provider, or this device does. */
export const hasKey = (settings: AiSettings, engine: AiEngine) => onServer(settings, engine) || !!settings.keys[engine.provider].trim()

/** "about $0.05", or null when the model's price isn't known. */
export function priceLabel(settings: AiSettings, engine = engineById(settings.engine)): string | null {
  const entry = PRICES[engineModel(settings, engine)]
  const price = typeof entry === 'number' ? entry : entry?.[settings.quality]
  if (price === undefined) return null
  // Two significant digits for cents and fractions of a cent: $0.013, $0.05, $0.20.
  return `about $${price >= 0.1 ? price.toFixed(2) : String(Number(price.toPrecision(2)))}`
}

const DETAIL_PROMPTS: Record<ColoringDetail, string> = {
  simple:
    'Make it easy to color for young children: bold, thick outlines, big simple shapes, and only the most important inner lines.',
  medium: 'Use a medium, even line weight and keep the main details.',
  detailed:
    'Use finer lines and keep more of the small details, like a coloring book for older children and adults, while every area stays big enough to color.',
}

/** What the model is asked to draw. */
export function coloringPrompt(detail: ColoringDetail): string {
  return [
    'Redraw this sticker as a page from a professional, high-quality coloring book.',
    'Clean black line art on a pure white background, like a crisp vector illustration: smooth, confident outlines with an even line weight, and every shape fully closed so it can be colored in.',
    'No color, no grey, no shading, no hatching, no gradients and no texture.',
    'Keep the same characters and objects, with the same pose, expression, proportions and composition, and keep what makes them recognizable (faces, eyes, hair, clothes, accessories).',
    'Only tiny areas such as pupils may be solid black; leave hair, clothes and everything else white so they can be colored.',
    'Leave out the white sticker border, any background, text, logos and watermarks.',
    'Center the drawing with a generous white margin around it.',
    DETAIL_PROMPTS[detail],
  ].join(' ')
}

export type AiSize = '1024x1024' | '1536x1024' | '1024x1536'

/** The output shape closest to the sticker's (width / height). */
export function aiSize(aspect: number): AiSize {
  if (aspect > 1.25) return '1536x1024'
  if (aspect < 0.8) return '1024x1536'
  return '1024x1024'
}

const ASPECT: Record<AiSize, string> = { '1024x1024': '1:1', '1536x1024': '3:2', '1024x1536': '2:3' }

/** Why a drawing failed: `refused` means the model won't draw this sticker, so another may. */
export type AiErrorKind = 'refused' | 'key' | 'other'

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind = 'other',
  ) {
    super(message)
  }
}

const REFUSAL = /safety|moderation|content policy|prohibited|blocked|refus|copyright|not allowed|policy/

/** Whose key a request used: the person's own, or the server's. */
export type KeySource = 'device' | 'server'

/** A message a person can act on, from a provider's error response. */
export function describeAiError(provider: AiProvider, status: number, message: string, source: KeySource = 'device'): AiError {
  const name = PROVIDERS[provider].name
  const text = message.toLowerCase()
  if (status === 401 || text.includes('api key not valid') || text.includes('invalid api key') || text.includes('incorrect api key'))
    return new AiError(
      source === 'server'
        ? `${name} rejected the app's API key. Check ${SERVER_KEYS[provider]} in the Vercel project's settings.`
        : `${name} rejected the API key. Check it in AI settings.`,
      'key',
    )
  if (provider === 'openai' && text.includes('verif') && text.includes('organization'))
    return new AiError(
      'OpenAI needs your organization verified before it can use image models. Do it at platform.openai.com → Settings → Organization, then try again.',
      'key',
    )
  if (text.includes('quota') || text.includes('billing') || text.includes('credit') || text.includes('balance') || status === 402)
    return new AiError(`Your ${name} account is out of credit, or billing isn’t set up for it.`, 'key')
  if (status === 429) return new AiError(`${name} is busy right now. Wait a minute and try again.`)
  if (REFUSAL.test(text)) return new AiError(`${name} declined to draw this sticker.`, 'refused')
  if (status === 403)
    return new AiError(`${name} didn’t allow this request. Check the key’s permissions${source === 'server' ? '' : ' in AI settings'}.`, 'key')
  if (status === 404 || (text.includes('model') && (text.includes('does not exist') || text.includes('not found'))))
    return new AiError(`That model isn’t available on your ${name} account. Pick another in AI settings.`, 'key')
  if (status >= 500) return new AiError(`${name} had a problem. Try again in a moment.`)
  return new AiError(message ? `${name} said: ${message}` : `${name} request failed (${status}).`)
}

// Image models usually take 10–60 seconds; give slow ones room before giving up.
const TIMEOUT = 180_000

async function post(provider: AiProvider, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT)
  try {
    return await fetch(url, { ...init, method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  } catch (err) {
    if (signal?.aborted) throw err
    const name = PROVIDERS[provider].name
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw new AiError(`${name} took too long to answer. Try again, or pick another model.`)
    if (globalThis.navigator?.onLine === false) throw new AiError('Drawing with AI needs an internet connection.')
    // Browsers report a blocked cross-site request the same way as a dropped connection.
    throw new AiError(`Couldn't reach ${name}. Try again in a moment; if it keeps failing, pick another model.`)
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null
}

function base64ToBlob(b64: string, type = 'image/png'): Blob {
  return new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type })
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export interface Job {
  image: Blob
  size: AiSize
  prompt: string
  model: string
  key: string
  quality: AiQuality
  source?: KeySource
  signal?: AbortSignal
}

async function drawWithOpenAi(job: Job): Promise<Blob> {
  const send = (highFidelity: boolean) => {
    const form = new FormData()
    form.append('model', job.model)
    form.append('prompt', job.prompt)
    form.append('image', new File([job.image], 'sticker.png', { type: 'image/png' }))
    form.append('size', job.size)
    form.append('quality', job.quality)
    form.append('background', 'opaque')
    form.append('output_format', 'png')
    form.append('n', '1')
    // Keeps the characters closer to the original, where the model supports it.
    if (highFidelity) form.append('input_fidelity', 'high')
    return post('openai', 'https://api.openai.com/v1/images/edits', { headers: { Authorization: `Bearer ${job.key}` }, body: form }, job.signal)
  }
  let response = await send(true)
  if (response.status === 400 && (await response.clone().text()).includes('input_fidelity')) response = await send(false)
  const body = await readJson<{ data?: { b64_json?: string }[]; error?: { message?: string } }>(response)
  if (!response.ok) throw describeAiError('openai', response.status, body?.error?.message ?? '', job.source)
  const b64 = body?.data?.[0]?.b64_json
  if (!b64) throw new AiError('OpenAI sent back no picture. Try again.')
  return base64ToBlob(b64)
}

async function drawWithGemini(job: Job): Promise<Blob> {
  const response = await post(
    'google',
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(job.model)}:generateContent`,
    {
      headers: { 'x-goog-api-key': job.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: job.prompt }, { inlineData: { mimeType: 'image/png', data: await blobToBase64(job.image) } }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ASPECT[job.size] } },
      }),
    },
    job.signal,
  )
  const body = await readJson<{
    candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[] } }[]
    promptFeedback?: { blockReason?: string }
    error?: { message?: string }
  }>(response)
  if (!response.ok) throw describeAiError('google', response.status, body?.error?.message ?? '', job.source)
  if (body?.promptFeedback?.blockReason) throw new AiError('Google declined to draw this sticker.', 'refused')
  const candidate = body?.candidates?.[0]
  const image = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
  if (image?.data) return base64ToBlob(image.data, image.mimeType ?? 'image/png')
  // No picture: the model either refused (safety, copyright) or answered in words instead.
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new AiError('Google declined to draw this sticker.', 'refused')
  throw new AiError('Google sent back no picture. Try again.')
}

async function drawWithFal(job: Job): Promise<Blob> {
  const [width, height] = job.size.split('x').map(Number)
  const imageUrl = `data:image/png;base64,${await blobToBase64(job.image)}`
  // Each model names its inputs a little differently. sync_mode returns the picture inline.
  const input: Record<string, unknown> = { prompt: job.prompt, num_images: 1, sync_mode: true }
  if (job.model.includes('seedream')) {
    Object.assign(input, { image_urls: [imageUrl], image_size: { width, height }, enable_safety_checker: true })
  } else if (job.model.includes('kontext')) {
    Object.assign(input, { image_url: imageUrl, aspect_ratio: ASPECT[job.size], output_format: 'png', safety_tolerance: '5' })
  } else {
    Object.assign(input, { image_url: imageUrl, output_format: 'png' })
  }
  const response = await post(
    'fal',
    `https://fal.run/${job.model}`,
    { headers: { Authorization: `Key ${job.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
    job.signal,
  )
  const body = await readJson<{
    images?: { url?: string }[]
    has_nsfw_concepts?: boolean[]
    detail?: string | { msg?: string }[]
    error?: string
  }>(response)
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : (body?.detail?.map((d) => d.msg).join('; ') ?? body?.error ?? '')
    throw describeAiError('fal', response.status, detail, job.source)
  }
  if (body?.has_nsfw_concepts?.[0]) throw new AiError('fal.ai’s safety filter blocked this drawing.', 'refused')
  const url = body?.images?.[0]?.url
  if (!url) throw new AiError('fal.ai sent back no picture. Try again.')
  try {
    return await (await fetch(url, { signal: job.signal })).blob()
  } catch {
    throw new AiError('Couldn’t download the drawing from fal.ai. Try again.')
  }
}

/**
 * QuiverAI's Arrow draws SVG from a description, with the sticker as a reference picture, so the
 * result is true vector line art. Returns the SVG, which is rendered at print size later.
 */
async function drawWithQuiver(job: Job): Promise<Blob> {
  const response = await post(
    'quiver',
    'https://api.quiver.ai/v1/svgs/generations',
    {
      headers: { Authorization: `Bearer ${job.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: job.model,
        prompt: 'A black-and-white coloring book page of exactly what is in the reference picture: the same characters, pose and composition, drawn as clean outlines.',
        instructions: `${job.prompt} Use black strokes only, with no fills except tiny solid black details like pupils.`,
        references: [{ base64: await blobToBase64(job.image) }],
        n: 1,
        stream: false,
      }),
    },
    job.signal,
  )
  const body = await readJson<{ data?: { svg?: string }[]; error?: { message?: string } | string; message?: string }>(response)
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? body?.message ?? '')
    throw describeAiError('quiver', response.status, message, job.source)
  }
  const svg = body?.data?.[0]?.svg
  if (!svg || !svg.includes('<svg')) throw new AiError('QuiverAI sent back no drawing. Try again.')
  return new Blob([svg], { type: 'image/svg+xml' })
}

export const DRAW: Record<AiProvider, (job: Job) => Promise<Blob>> = {
  openai: drawWithOpenAi,
  google: drawWithGemini,
  fal: drawWithFal,
  quiver: drawWithQuiver,
}

/**
 * Asks the chosen model to redraw `image` (the sticker on white, already shaped like `size`) as a
 * coloring page. Returns the drawing as an image (SVG from vector models).
 */
export function requestAiLineArt(
  image: Blob,
  size: AiSize,
  detail: ColoringDetail,
  settings: AiSettings,
  signal?: AbortSignal,
  engine = engineById(settings.engine),
): Promise<Blob> {
  if (settings.server && onServer(settings, engine)) {
    const request = { engine: engine.id, model: engineModel(settings, engine), size, detail, quality: settings.quality }
    return drawOnServer(settings.server.url, image, request, signal)
  }
  return DRAW[engine.provider]({
    image,
    size,
    prompt: coloringPrompt(detail),
    model: engineModel(settings, engine),
    key: settings.keys[engine.provider].trim(),
    quality: settings.quality,
    signal,
  })
}

/** What the app sends the server to draw, besides the picture. */
export interface AiDrawRequest {
  engine: string
  model: string
  size: AiSize
  detail: ColoringDetail
  quality: AiQuality
}

/** The server's answer when a drawing fails. */
export interface AiDrawError {
  error: string
  kind: AiErrorKind
}

async function drawOnServer(url: string, image: Blob, request: AiDrawRequest, signal?: AbortSignal): Promise<Blob> {
  const form = new FormData()
  form.append('image', new File([image], 'sticker.png', { type: 'image/png' }))
  for (const [name, value] of Object.entries(request)) form.append(name, value)
  // A little longer than the server gives the provider, so its own timeout message gets through.
  const timeout = AbortSignal.timeout(TIMEOUT + 15_000)
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', body: form, credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  } catch (err) {
    if (signal?.aborted) throw err
    if (globalThis.navigator?.onLine === false) throw new AiError('Drawing with AI needs an internet connection.')
    throw new AiError('Couldn’t reach the server to draw this. Try again in a moment.')
  }
  if (response.ok) return response.blob()
  if (response.status === 401) throw new AiError('Sign in again to draw with AI.', 'key')
  const body = await readJson<AiDrawError>(response)
  throw new AiError(body?.error || `The drawing failed (${response.status}). Try again.`, body?.kind ?? 'other')
}
