import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupingRoutes, toGeminiSchema } from '../../server/grouping'

const app = new Hono().route('/', groupingRoutes)

function describeRequest(type = 'image/jpeg') {
  const form = new FormData()
  form.append('image', new File(['jpeg'], 'sticker.jpg', { type }))
  return app.request('/ai/describe', { method: 'POST', body: form })
}

const groupRequest = (body: unknown) =>
  app.request('/ai/group', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

const gemini = (answer: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }))

describe('AI folder routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('describes a sticker with Gemini, as JSON in the shape asked for', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-server')
    vi.stubEnv('OPENAI_API_KEY', 'sk-server')
    const fetch = vi.fn().mockResolvedValue(gemini({ subject: ' Bluey ', series: 'Bluey', tags: ['Cartoon', 'dog', 'dog', 'blue'], topic: 'cartoons' }))
    vi.stubGlobal('fetch', fetch)
    const response = await describeRequest()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: 1, subject: 'Bluey', series: 'Bluey', tags: ['cartoon', 'dog', 'blue'], topic: 'cartoons' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toContain('/models/gemini-3.6-flash:generateContent')
    expect(init.headers['x-goog-api-key']).toBe('AIza-server')
    const sent = JSON.parse(init.body)
    expect(sent.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/jpeg', data: btoa('jpeg') })
    expect(sent.generationConfig.responseMimeType).toBe('application/json')
    expect(sent.generationConfig.responseSchema.type).toBe('OBJECT')
    expect(JSON.stringify(sent.generationConfig.responseSchema)).not.toContain('additionalProperties')
  })

  it('falls back to OpenAI, with a strict schema', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', 'sk-server')
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ subject: 'Pikachu', series: 'Pokémon', tags: [], topic: 'nope' }) } }] })),
    )
    vi.stubGlobal('fetch', fetch)
    const response = await describeRequest()
    expect(await response.json()).toMatchObject({ subject: 'Pikachu', series: 'Pokémon', topic: 'other' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    const sent = JSON.parse(init.body)
    expect(sent.model).toBe('gpt-5-mini')
    expect(sent.response_format.json_schema.strict).toBe(true)
    expect(sent.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('needs a key, a picture, and a sane request', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('OPENAI_API_KEY', '')
    expect((await describeRequest()).status).toBe(409)
    vi.stubEnv('GEMINI_API_KEY', 'AIza-server')
    expect((await describeRequest('image/svg+xml')).status).toBe(400)
    expect((await groupRequest({ folders: [], stickers: [] })).status).toBe(400)
    expect((await groupRequest({ folders: 'x', stickers: [{ id: 'a', subject: 'x', series: '', tags: [] }] })).status).toBe(400)
  })

  it('sorts stickers into folders, reusing existing ones', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'AIza-server')
    const fetch = vi.fn().mockResolvedValue(
      gemini({
        folders: [
          { name: 'bluey', emoji: 'nope', stickers: [1, 3] },
          { name: 'Food', emoji: '🍕 pizza', stickers: [2, 3, 9] },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const response = await groupRequest({
      total: 10,
      folders: [{ name: 'Bluey', emoji: '🐶', count: 4, examples: ['Bluey', 'Bingo'] }],
      stickers: [
        { id: 's1', subject: 'Bandit', series: 'Bluey', tags: ['cartoon'] },
        { id: 's2', subject: 'Pizza slice', series: '', tags: ['food'] },
        { id: 's3', subject: 'Chilli', series: 'Bluey', tags: [] },
      ],
    })
    expect(response.status).toBe(200)
    // The existing folder keeps its spelling; a sticker named twice stays in its first folder.
    expect(await response.json()).toEqual({
      assignments: [
        { id: 's1', name: 'Bluey', emoji: '🐶' },
        { id: 's3', name: 'Bluey', emoji: '🐶' },
        { id: 's2', name: 'Food', emoji: '🍕' },
      ],
    })
    const prompt: string = JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts[0].text
    expect(prompt).toContain('🐶 Bluey (4 stickers')
    expect(prompt).toContain('1. Bandit [Bluey] (cartoon)')
  })
})

describe('toGeminiSchema', () => {
  it('upper-cases types and drops additionalProperties at every level', () => {
    expect(
      toGeminiSchema({
        type: 'object',
        additionalProperties: false,
        properties: { list: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { n: { type: 'integer' } } } } },
      }),
    ).toEqual({ type: 'OBJECT', properties: { list: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' } } } } } })
  })
})
