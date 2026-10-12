// AI coloring pages drawn with the app's own keys, so signed-in people don't need their own.
// Each provider's key is a Vercel environment variable (SERVER_KEYS); providers without one
// aren't offered, and the app falls back to keys saved on the device.

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  AI_ENGINES,
  AI_QUALITIES,
  AiError,
  coloringPrompt,
  DRAW,
  SERVER_KEYS,
  type AiDrawError,
  type AiProvider,
  type AiQuality,
  type AiSize,
} from '../src/lib/ai-coloring.js'
import type { ColoringDetail } from '../src/lib/coloring.js'
import { folderProvider } from './grouping.js'
import type { SignedIn } from './sync.js'

const SIZES: AiSize[] = ['1024x1024', '1536x1024', '1024x1536']
// Not imported from coloring.ts, which pulls in the image code.
const DETAILS: ColoringDetail[] = ['simple', 'medium', 'detailed']
// A 1536px sticker on white is well under this; Vercel caps request bodies at 4.5 MB.
const MAX_BODY = 4 * 1024 * 1024
const MODEL = /^[\w.\-/]{1,120}$/

/** The providers this server has a key for. */
export function serverProviders(): AiProvider[] {
  return (Object.keys(SERVER_KEYS) as AiProvider[]).filter((p) => process.env[SERVER_KEYS[p]]?.trim())
}

const fail = (error: string, kind: AiDrawError['kind'] = 'other') => ({ error, kind }) satisfies AiDrawError

export const aiRoutes = new Hono<SignedIn>()

aiRoutes.get('/ai/providers', (c) => {
  c.header('Cache-Control', 'no-store')
  // `folders`: whether the server can sort stickers into AI folders.
  return c.json({ providers: serverProviders(), folders: !!folderProvider() })
})

aiRoutes.post(
  '/ai/draw',
  bodyLimit({
    maxSize: MAX_BODY,
    onError: (c) => c.json(fail('That picture is too big to draw.'), 413),
  }),
  async (c) => {
    const form = await c.req.formData().catch(() => null)
    const field = (name: string) => {
      const value = form?.get(name)
      return typeof value === 'string' ? value : ''
    }
    const image = form?.get('image')
    const engine = AI_ENGINES.find((e) => e.id === field('engine'))
    const model = field('model') || engine?.model || ''
    const size = field('size') as AiSize
    const detail = field('detail') as ColoringDetail
    const quality = (field('quality') || 'medium') as AiQuality
    if (
      !(image instanceof Blob) ||
      !engine ||
      !MODEL.test(model) ||
      model.includes('..') ||
      !SIZES.includes(size) ||
      !DETAILS.includes(detail) ||
      !AI_QUALITIES.includes(quality)
    ) {
      return c.json(fail('Bad drawing request'), 400)
    }

    const key = process.env[SERVER_KEYS[engine.provider]]?.trim()
    if (!key) return c.json(fail(`The app has no ${engine.name} key set up.`, 'key'), 409)

    try {
      const drawn = await DRAW[engine.provider]({
        image,
        size,
        prompt: coloringPrompt(detail),
        model,
        key,
        quality,
        source: 'server',
        signal: c.req.raw.signal,
      })
      c.header('Cache-Control', 'no-store')
      return c.body(await drawn.arrayBuffer(), 200, {
        'Content-Type': drawn.type || 'image/png',
      })
    } catch (err) {
      if (err instanceof AiError) return c.json(fail(err.message, err.kind), 502)
      throw err
    }
  },
)
