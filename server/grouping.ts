// AI folders, with the app's own keys: a vision model says what each sticker shows, and a
// language model sorts the collection into folders (see src/lib/smart-groups.ts). Gemini when
// GEMINI_API_KEY is set, otherwise OpenAI; without either, the app keeps its on-device topics.

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { AiError, describeAiError, SERVER_KEYS, type AiProvider } from '../src/lib/ai-coloring.js'
import {
  cleanDescription,
  cleanGrouping,
  DESCRIBE_PROMPT,
  DESCRIBE_SCHEMA,
  GROUP_SCHEMA,
  groupPrompt,
  MAX_GROUP_BATCH,
  type GroupRequest,
} from '../src/lib/smart-groups.js'
import type { SignedIn } from './sync.js'

/** Fast, cheap models that see pictures and answer in JSON. */
export const FOLDER_MODELS = { google: 'gemini-3.6-flash', openai: 'gpt-5-mini' } as const
type FolderProvider = keyof typeof FOLDER_MODELS

// The app sends stickers at most 512 px across.
const MAX_IMAGE = 2 * 1024 * 1024
const MAX_GROUP_BODY = 512 * 1024
const TIMEOUT = 60_000

/** The provider AI folders use, or none when the server has no key for one. */
export function folderProvider(): { provider: FolderProvider; key: string } | null {
  for (const provider of ['google', 'openai'] as const) {
    const key = process.env[SERVER_KEYS[provider]]?.trim()
    if (key) return { provider, key }
  }
  return null
}

interface Ask {
  prompt: string
  schema: object
  image?: { type: string; base64: string }
  signal?: AbortSignal
}

/** Gemini takes OpenAPI-style schemas: upper-case types and no additionalProperties. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue
    if (key === 'type' && typeof value === 'string') out.type = value.toUpperCase()
    else if (key === 'properties') out.properties = Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, toGeminiSchema(v)]))
    else out[key] = toGeminiSchema(value)
  }
  return out
}

async function post(provider: AiProvider, url: string, init: RequestInit, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(TIMEOUT)
  try {
    return await fetch(url, { ...init, method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new AiError(`Couldn't reach ${provider === 'google' ? 'Google' : 'OpenAI'}. Try again in a moment.`)
  }
}

function parseJson(text: string | undefined, provider: string): unknown {
  try {
    return JSON.parse(text ?? '')
  } catch {
    throw new AiError(`${provider} didn't answer in the expected format. Try again.`)
  }
}

async function askGemini(key: string, ask: Ask): Promise<unknown> {
  const parts: object[] = [{ text: ask.prompt }]
  if (ask.image) parts.push({ inlineData: { mimeType: ask.image.type, data: ask.image.base64 } })
  const response = await post(
    'google',
    `https://generativelanguage.googleapis.com/v1beta/models/${FOLDER_MODELS.google}:generateContent`,
    {
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(ask.schema) },
      }),
    },
    ask.signal,
  )
  const body = (await response.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    promptFeedback?: { blockReason?: string }
    error?: { message?: string }
  } | null
  if (!response.ok) throw describeAiError('google', response.status, body?.error?.message ?? '', 'server')
  if (body?.promptFeedback?.blockReason) throw new AiError('Google declined to look at this sticker.', 'refused')
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  return parseJson(text, 'Google')
}

async function askOpenAi(key: string, ask: Ask): Promise<unknown> {
  const content: object[] = [{ type: 'text', text: ask.prompt }]
  if (ask.image) content.push({ type: 'image_url', image_url: { url: `data:${ask.image.type};base64,${ask.image.base64}`, detail: 'low' } })
  const response = await post(
    'openai',
    'https://api.openai.com/v1/chat/completions',
    {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: FOLDER_MODELS.openai,
        messages: [{ role: 'user', content }],
        reasoning_effort: 'low',
        response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: ask.schema } },
      }),
    },
    ask.signal,
  )
  const body = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[]
    error?: { message?: string }
  } | null
  if (!response.ok) throw describeAiError('openai', response.status, body?.error?.message ?? '', 'server')
  const message = body?.choices?.[0]?.message
  if (message?.refusal) throw new AiError('OpenAI declined to look at this sticker.', 'refused')
  return parseJson(message?.content ?? undefined, 'OpenAI')
}

/** Asks the server's folder model for JSON matching `schema`. */
export function askForJson(provider: FolderProvider, key: string, ask: Ask): Promise<unknown> {
  return provider === 'google' ? askGemini(key, ask) : askOpenAi(key, ask)
}

const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
const strings = (v: unknown, count: number, max: number) => Array.isArray(v) && v.length <= count && v.every((t) => str(t, max))

/** A grouping request from the app, checked. Throws on anything else. */
export function cleanGroupRequest(raw: unknown): { request: GroupRequest; total: number } {
  const r = raw as { folders?: unknown; stickers?: unknown; total?: unknown } | null
  const folders = r?.folders
  const stickers = r?.stickers
  if (!Array.isArray(folders) || folders.length > 60 || !Array.isArray(stickers) || !stickers.length || stickers.length > MAX_GROUP_BATCH)
    throw new Error('Bad grouping request')
  for (const f of folders)
    if (!str(f?.name, 40) || !str(f?.emoji, 16) || typeof f.count !== 'number' || !strings(f.examples, 4, 80)) throw new Error('Bad folder')
  for (const s of stickers)
    if (!str(s?.id, 64) || !str(s.subject, 80) || !str(s.series, 80) || !strings(s.tags, 6, 30)) throw new Error('Bad sticker')
  const total = typeof r!.total === 'number' && Number.isFinite(r!.total) ? Math.max(stickers.length, Math.min(100_000, Math.round(r!.total))) : stickers.length
  return {
    request: {
      folders: folders.map(({ name, emoji, count, examples }) => ({ name, emoji, count, examples })),
      stickers: stickers.map(({ id, subject, series, tags }) => ({ id, subject, series, tags })),
    },
    total,
  }
}

const fail = (error: string, kind: AiError['kind'] = 'other') => ({ error, kind })

export const groupingRoutes = new Hono<SignedIn>()

groupingRoutes.post(
  '/ai/describe',
  bodyLimit({ maxSize: MAX_IMAGE + 64 * 1024, onError: (c) => c.json(fail('That sticker is too big to look at.'), 413) }),
  async (c) => {
    const ai = folderProvider()
    if (!ai) return c.json(fail('The app has no AI key for folders.', 'key'), 409)
    const form = await c.req.formData().catch(() => null)
    const image = form?.get('image')
    if (!(image instanceof Blob) || !['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > MAX_IMAGE)
      return c.json(fail('Bad sticker'), 400)
    try {
      const raw = await askForJson(ai.provider, ai.key, {
        prompt: DESCRIBE_PROMPT,
        schema: DESCRIBE_SCHEMA,
        image: { type: image.type, base64: Buffer.from(await image.arrayBuffer()).toString('base64') },
        signal: c.req.raw.signal,
      })
      c.header('Cache-Control', 'no-store')
      return c.json(cleanDescription(raw))
    } catch (err) {
      if (err instanceof AiError) return c.json(fail(err.message, err.kind), 502)
      if (err instanceof Error && err.message.startsWith('No subject')) return c.json(fail("Couldn't tell what this sticker shows."), 502)
      throw err
    }
  },
)

groupingRoutes.post(
  '/ai/group',
  bodyLimit({ maxSize: MAX_GROUP_BODY, onError: (c) => c.json(fail('Too many stickers at once.'), 413) }),
  async (c) => {
    const ai = folderProvider()
    if (!ai) return c.json(fail('The app has no AI key for folders.', 'key'), 409)
    let cleaned: ReturnType<typeof cleanGroupRequest>
    try {
      cleaned = cleanGroupRequest(await c.req.json())
    } catch {
      return c.json(fail('Bad grouping request'), 400)
    }
    try {
      const raw = await askForJson(ai.provider, ai.key, {
        prompt: groupPrompt(cleaned.request, cleaned.total),
        schema: GROUP_SCHEMA,
        signal: c.req.raw.signal,
      })
      c.header('Cache-Control', 'no-store')
      return c.json(cleanGrouping(raw, cleaned.request))
    } catch (err) {
      if (err instanceof AiError) return c.json(fail(err.message, err.kind), 502)
      if (err instanceof Error && err.message.startsWith('No folders')) return c.json(fail("Couldn't sort the stickers. Try again."), 502)
      throw err
    }
  },
)
