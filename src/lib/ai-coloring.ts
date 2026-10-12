// Coloring pages drawn by OpenAI's image model: the sticker goes in, clean line art comes out.
// Uses the person's own API key, kept on their device.

import type { ColoringDetail } from './coloring'

export const AI_MODELS = ['gpt-image-1.5', 'gpt-image-1-mini'] as const
export type AiQuality = 'low' | 'medium' | 'high'
export const AI_QUALITIES: AiQuality[] = ['low', 'medium', 'high']

/** Rough price per page in US dollars, for a portrait or landscape image (OpenAI bills by size). */
export const AI_PRICE: Record<string, Record<AiQuality, number>> = {
  'gpt-image-1.5': { low: 0.013, medium: 0.05, high: 0.2 },
  'gpt-image-1-mini': { low: 0.006, medium: 0.015, high: 0.052 },
}

export interface AiSettings {
  key: string
  model: string
  quality: AiQuality
}

const KEY = 'stickers.ai.key'
const MODEL = 'stickers.ai.model'
const QUALITY = 'stickers.ai.quality'

export function loadAiSettings(): AiSettings {
  const read = (key: string) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const quality = read(QUALITY)
  return {
    key: read(KEY) ?? '',
    model: read(MODEL) || AI_MODELS[0],
    quality: (AI_QUALITIES as string[]).includes(quality ?? '') ? (quality as AiQuality) : 'medium',
  }
}

export function saveAiSettings(settings: AiSettings) {
  try {
    if (settings.key) localStorage.setItem(KEY, settings.key.trim())
    else localStorage.removeItem(KEY)
    localStorage.setItem(MODEL, settings.model.trim() || AI_MODELS[0])
    localStorage.setItem(QUALITY, settings.quality)
  } catch {
    // Without storage the settings only last this session.
  }
}

/** "about $0.05", or null when the model's price isn't known. */
export function priceLabel(settings: Pick<AiSettings, 'model' | 'quality'>): string | null {
  const price = AI_PRICE[settings.model]?.[settings.quality]
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

export class AiError extends Error {}

/** A message a person can act on, from OpenAI's error response. */
export function describeAiError(status: number, message: string): string {
  const text = message.toLowerCase()
  if (status === 401) return 'OpenAI rejected the API key. Check it in AI settings.'
  if (text.includes('verif') && text.includes('organization'))
    return 'OpenAI needs your organization verified before it can use image models. Do it at platform.openai.com → Settings → Organization, then try again.'
  if (status === 429 && (text.includes('quota') || text.includes('billing') || text.includes('credit')))
    return 'Your OpenAI account is out of credit. Add some at platform.openai.com → Billing.'
  if (status === 429) return 'OpenAI is busy right now. Wait a minute and try again.'
  if (text.includes('safety') || text.includes('moderation') || text.includes('content policy'))
    return 'OpenAI declined to draw this sticker. Try the free drawing instead.'
  if (status === 404 || (text.includes('model') && text.includes('does not exist')))
    return 'That model isn’t available on your OpenAI account. Pick another one in AI settings.'
  if (status >= 500) return 'OpenAI had a problem. Try again in a moment.'
  return message ? `OpenAI said: ${message}` : `OpenAI request failed (${status}).`
}

const ENDPOINT = 'https://api.openai.com/v1/images/edits'
// Image edits usually take 20–60 seconds; give slow ones room before giving up.
const TIMEOUT = 180_000

/**
 * Asks OpenAI to redraw `image` (the sticker on white, already shaped like `size`) as a coloring
 * page. Returns the drawing as a PNG.
 */
export async function requestAiLineArt(
  image: Blob,
  size: AiSize,
  detail: ColoringDetail,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<Blob> {
  const send = async (highFidelity: boolean) => {
    const form = new FormData()
    form.append('model', settings.model)
    form.append('prompt', coloringPrompt(detail))
    form.append('image', new File([image], 'sticker.png', { type: 'image/png' }))
    form.append('size', size)
    form.append('quality', settings.quality)
    form.append('background', 'opaque')
    form.append('output_format', 'png')
    form.append('n', '1')
    // Keeps the characters closer to the original, where the model supports it.
    if (highFidelity) form.append('input_fidelity', 'high')
    const timeout = AbortSignal.timeout(TIMEOUT)
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.key.trim()}` },
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  }

  let response: Response
  try {
    response = await send(true)
    if (response.status === 400) {
      const body = await response.clone().text()
      if (body.includes('input_fidelity')) response = await send(false)
    }
  } catch (err) {
    if (signal?.aborted) throw err
    if (err instanceof DOMException && err.name === 'TimeoutError')
      throw new AiError('OpenAI took too long to answer. Try again, or pick a lower quality.')
    throw new AiError(navigator.onLine ? "Couldn't reach OpenAI. Try again in a moment." : 'Drawing with AI needs an internet connection.')
  }

  const body = (await response.json().catch(() => null)) as {
    data?: { b64_json?: string }[]
    error?: { message?: string }
  } | null
  if (!response.ok) throw new AiError(describeAiError(response.status, body?.error?.message ?? ''))
  const b64 = body?.data?.[0]?.b64_json
  if (!b64) throw new AiError('OpenAI sent back no picture. Try again.')
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type: 'image/png' })
}
