// Coloring pages drawn by an AI image model: the sticker goes in, clean line art comes out.
// Several models from four providers are offered, since each refuses or struggles with
// different pictures. They use the person's own API keys, kept on their device.

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
    note: 'Sign in, then create a Production key under API keys (test keys only return a placeholder). Arrow 2 is priced by how much drawing it produces.',
  },
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
  const clean: AiSettings = {
    ...settings,
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

/** Whether the engine's provider has a key. */
export const hasKey = (settings: AiSettings, engine: AiEngine) => !!settings.keys[engine.provider].trim()

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

/** A message a person can act on, from a provider's error response. */
export function describeAiError(provider: AiProvider, status: number, message: string): AiError {
  const name = PROVIDERS[provider].name
  const text = message.toLowerCase()
  if (status === 401 || text.includes('api key not valid') || text.includes('invalid api key') || text.includes('incorrect api key'))
    return new AiError(`${name} rejected the API key. Check it in AI settings.`, 'key')
  if (provider === 'openai' && text.includes('verif') && text.includes('organization'))
    return new AiError(
      'OpenAI needs your organization verified before it can use image models. Do it at platform.openai.com → Settings → Organization, then try again.',
      'key',
    )
  if (text.includes('quota') || text.includes('billing') || text.includes('credit') || text.includes('balance') || status === 402)
    return new AiError(`Your ${name} account is out of credit, or billing isn’t set up for it.`, 'key')
  if (status === 429) return new AiError(`${name} is busy right now. Wait a minute and try again.`)
  if (REFUSAL.test(text)) return new AiError(`${name} declined to draw this sticker.`, 'refused')
  if (status === 403) return new AiError(`${name} didn’t allow this request. Check the key’s permissions in AI settings.`, 'key')
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
    if (!navigator.onLine) throw new AiError('Drawing with AI needs an internet connection.')
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

interface Job {
  image: Blob
  size: AiSize
  prompt: string
  model: string
  key: string
  quality: AiQuality
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
  if (!response.ok) throw describeAiError('openai', response.status, body?.error?.message ?? '')
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
  if (!response.ok) throw describeAiError('google', response.status, body?.error?.message ?? '')
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
    throw describeAiError('fal', response.status, detail)
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
const QUIVER_TEST_KEY =
  'That’s a QuiverAI test key: it returns a placeholder instead of a drawing. Create a Production key in QuiverAI and paste it in AI settings.'

async function drawWithQuiver(job: Job): Promise<Blob> {
  // Test (sandbox) keys never reach a model; they answer with a fixed placeholder picture.
  if (job.key.startsWith('sk_test_')) throw new AiError(QUIVER_TEST_KEY, 'key')
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
    throw describeAiError('quiver', response.status, message)
  }
  const svg = body?.data?.[0]?.svg
  if (response.headers.get('x-quiver-environment') === 'test' || svg?.includes('SANDBOX RESULT'))
    throw new AiError(QUIVER_TEST_KEY, 'key')
  if (!svg || !svg.includes('<svg')) throw new AiError('QuiverAI sent back no drawing. Try again.')
  return new Blob([svg], { type: 'image/svg+xml' })
}

const DRAW: Record<AiProvider, (job: Job) => Promise<Blob>> = {
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
