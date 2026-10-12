import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiRoutes } from '../../server/ai'

const app = new Hono().route('/', aiRoutes)

function drawRequest(fields: Record<string, string> = {}) {
  const form = new FormData()
  form.append('image', new File(['sticker'], 'sticker.png', { type: 'image/png' }))
  const all = { engine: 'gemini', model: 'gemini-3.1-flash-image', size: '1024x1024', detail: 'medium', quality: 'medium', ...fields }
  for (const [name, value] of Object.entries(all)) form.append(name, value)
  return app.request('/ai/draw', { method: 'POST', body: form })
}

describe('AI routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('lists only the providers with a key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', 'AIza-server')
    vi.stubEnv('FAL_KEY', ' ')
    vi.stubEnv('QUIVER_API_KEY', '')
    const response = await app.request('/ai/providers')
    expect(await response.json()).toEqual({ providers: ['google'], folders: true })
  })

  it('draws with the server key and sends back the picture', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-server')
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: btoa('png') } }] } }] })),
    )
    vi.stubGlobal('fetch', fetch)
    const response = await drawRequest()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(await response.text()).toBe('png')
    expect(fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('AIza-server')
  })

  it('says which variable to fix when the provider rejects the key', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-bad')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })))
    const response = await drawRequest()
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.kind).toBe('key')
    expect(body.error).toContain('GEMINI_API_KEY')
  })

  it('refuses providers without a key, and bad requests', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', 'AIza-server')
    expect((await drawRequest({ engine: 'openai', model: 'gpt-image-1.5' })).status).toBe(409)
    expect((await drawRequest({ size: '9999x9999' })).status).toBe(400)
    expect((await drawRequest({ engine: 'kontext', model: '../../other' })).status).toBe(400)
  })
})
