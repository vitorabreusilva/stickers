import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiError, aiSize, coloringPrompt, describeAiError, priceLabel, requestAiLineArt, type AiSettings } from '../src/lib/ai-coloring'
import { cleanLineArt } from '../src/lib/line-art'

const settings: AiSettings = {
  engine: 'openai',
  keys: { openai: ' sk-test ', google: 'AIza-test', fal: 'fal-test', quiver: 'qv-test' },
  models: {},
  quality: 'medium',
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('requestAiLineArt', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the sticker to the image edit endpoint and returns the drawing', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: btoa(String.fromCharCode(...png)) }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetch)
    const result = await requestAiLineArt(new Blob(['x']), '1024x1536', 'simple', settings)

    expect(new Uint8Array(await result.arrayBuffer())).toEqual(png)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    expect(init.headers.Authorization).toBe('Bearer sk-test')
    const form = init.body as FormData
    expect(form.get('model')).toBe('gpt-image-1.5')
    expect(form.get('size')).toBe('1024x1536')
    expect(form.get('quality')).toBe('medium')
    expect(form.get('input_fidelity')).toBe('high')
    expect(form.get('prompt')).toContain('coloring book')
    expect(form.get('prompt')).toContain('young children')
    expect(form.get('image')).toBeInstanceOf(File)
  })

  it('retries without input_fidelity on models that refuse it', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unknown parameter: 'input_fidelity'." } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: btoa('ok') }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await requestAiLineArt(new Blob(['x']), '1024x1024', 'medium', settings)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((fetch.mock.calls[1][1].body as FormData).has('input_fidelity')).toBe(false)
  })

  it('explains failures in plain words', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 })))
    await expect(requestAiLineArt(new Blob(['x']), '1024x1024', 'medium', settings)).rejects.toThrow('OpenAI rejected the API key')
  })

  it('marks refusals, so another model can be offered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Your request was rejected by the safety system.' } }), { status: 400 })),
    )
    const err = await requestAiLineArt(new Blob(['x']), '1024x1024', 'medium', settings).catch((e) => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.kind).toBe('refused')
  })

  it('draws with Google Nano Banana 2', async () => {
    const fetch = vi.fn().mockResolvedValue(
      ok({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: btoa('png') } }] } }] }),
    )
    vi.stubGlobal('fetch', fetch)
    const result = await requestAiLineArt(new Blob(['sticker']), '1024x1536', 'medium', { ...settings, engine: 'gemini' })
    expect(await result.text()).toBe('png')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent')
    expect(init.headers['x-goog-api-key']).toBe('AIza-test')
    const body = JSON.parse(init.body)
    expect(body.generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '2:3' } })
    expect(body.contents[0].parts[0].text).toContain('coloring book')
    expect(atob(body.contents[0].parts[1].inlineData.data)).toBe('sticker')
  })

  it('treats a Google answer without a picture as a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] })))
    const err = await requestAiLineArt(new Blob(['x']), '1024x1024', 'medium', { ...settings, engine: 'gemini' }).catch((e) => e)
    expect(err.kind).toBe('refused')
  })

  it.each([
    ['kontext', 'fal-ai/flux-pro/kontext', { image_url: 'data:image/png;base64,c3RpY2tlcg==', aspect_ratio: '3:2' }],
    ['seedream', 'fal-ai/bytedance/seedream/v4/edit', { image_urls: ['data:image/png;base64,c3RpY2tlcg=='], image_size: { width: 1536, height: 1024 } }],
    ['qwen', 'fal-ai/qwen-image-edit', { image_url: 'data:image/png;base64,c3RpY2tlcg==' }],
  ])('draws with %s on fal.ai', async (engine, endpoint, expected) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ images: [{ url: 'data:image/png;base64,' + btoa('drawn') }] }))
      .mockResolvedValueOnce(new Response(new Blob(['drawn'])))
    vi.stubGlobal('fetch', fetch)
    const result = await requestAiLineArt(new Blob(['sticker']), '1536x1024', 'medium', { ...settings, engine })
    expect(await result.text()).toBe('drawn')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(`https://fal.run/${endpoint}`)
    expect(init.headers.Authorization).toBe('Key fal-test')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ ...expected, sync_mode: true, num_images: 1 })
    expect(body.prompt).toContain('coloring book')
  })

  it('draws vector line art with QuiverAI Arrow 2', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" stroke="#000" fill="none"/></svg>'
    const fetch = vi.fn().mockResolvedValue(ok({ id: 'gen_1', data: [{ svg, mime_type: 'image/svg+xml' }], credits: 3 }))
    vi.stubGlobal('fetch', fetch)
    const result = await requestAiLineArt(new Blob(['sticker']), '1024x1024', 'detailed', { ...settings, engine: 'quiver' })
    expect(result.type).toBe('image/svg+xml')
    expect(await result.text()).toBe(svg)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.quiver.ai/v1/svgs/generations')
    expect(init.headers.Authorization).toBe('Bearer qv-test')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ model: 'arrow-2', n: 1, stream: false, references: [{ base64: btoa('sticker') }] })
    expect(body.prompt).toContain('coloring book page')
    expect(body.instructions).toContain('older children')
  })

  it('draws through the server when it has a key for the provider', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Blob(['drawn'], { type: 'image/png' })))
    vi.stubGlobal('fetch', fetch)
    const server = { url: '/api/ai/draw', providers: ['google' as const] }
    const result = await requestAiLineArt(new Blob(['sticker']), '1024x1536', 'simple', { ...settings, engine: 'gemini', server })
    expect(await result.text()).toBe('drawn')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/ai/draw')
    const form = init.body as FormData
    expect(Object.fromEntries([...form].filter(([k]) => k !== 'image'))).toEqual({
      engine: 'gemini',
      model: 'gemini-3.1-flash-image',
      size: '1024x1536',
      detail: 'simple',
      quality: 'medium',
    })
    expect(form.get('image')).toBeInstanceOf(File)

    // Providers the server has no key for still use the device's.
    fetch.mockResolvedValue(ok({ data: [{ b64_json: btoa('x') }] }))
    await requestAiLineArt(new Blob(['x']), '1024x1024', 'medium', { ...settings, server })
    expect(fetch.mock.calls[1][0]).toBe('https://api.openai.com/v1/images/edits')
  })

  it('passes on the server’s explanation of a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Google declined to draw this sticker.', kind: 'refused' }), { status: 502 })))
    const server = { url: '/api/ai/draw', providers: ['google' as const] }
    const err = await requestAiLineArt(new Blob(['x']), '1024x1024', 'medium', { ...settings, engine: 'gemini', server }).catch((e) => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err.message).toBe('Google declined to draw this sticker.')
    expect(err.kind).toBe('refused')
  })

  it('uses a model name typed into the settings', async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ inlineData: { data: btoa('x') } }] } }] }))
    vi.stubGlobal('fetch', fetch)
    await requestAiLineArt(new Blob(['x']), '1024x1024', 'medium', { ...settings, engine: 'gemini', models: { gemini: 'gemini-next-image' } })
    expect(fetch.mock.calls[0][0]).toContain('/models/gemini-next-image:generateContent')
  })
})

describe('AI helpers', () => {
  it('picks the output shape closest to the sticker', () => {
    expect(aiSize(2)).toBe('1536x1024')
    expect(aiSize(1)).toBe('1024x1024')
    expect(aiSize(0.6)).toBe('1024x1536')
  })

  it('asks for clean closed outlines without shading, at each detail level', () => {
    for (const detail of ['simple', 'medium', 'detailed'] as const) {
      const prompt = coloringPrompt(detail)
      expect(prompt).toContain('fully closed')
      expect(prompt).toContain('No color, no grey, no shading')
    }
    expect(coloringPrompt('detailed')).not.toBe(coloringPrompt('simple'))
  })

  it('turns provider errors into next steps', () => {
    expect(describeAiError('openai', 403, 'Your organization must be verified to use the model').message).toContain('verified')
    expect(describeAiError('openai', 429, 'You exceeded your current quota, please check your plan and billing').message).toContain('out of credit')
    expect(describeAiError('google', 429, 'Rate limit reached').message).toBe('Google is busy right now. Wait a minute and try again.')
    expect(describeAiError('google', 400, 'API key not valid. Please pass a valid API key.').kind).toBe('key')
    expect(describeAiError('fal', 403, 'User is locked. Reason: Exhausted balance.').message).toContain('out of credit')
    expect(describeAiError('openai', 400, 'Something odd').message).toBe('OpenAI said: Something odd')
  })

  it('shows a price only for models it knows', () => {
    expect(priceLabel(settings)).toBe('about $0.05')
    expect(priceLabel({ ...settings, models: { openai: 'gpt-image-1-mini' }, quality: 'low' })).toBe('about $0.006')
    expect(priceLabel({ ...settings, engine: 'kontext' })).toBe('about $0.04')
    expect(priceLabel({ ...settings, models: { openai: 'something-new' } })).toBeNull()
  })
})

describe('cleanLineArt', () => {
  /** A white picture with a black ring, a light grey patch (shading) and a lone speck. */
  function drawing() {
    const w = 200
    const h = 160
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = Math.hypot(x - 100, y - 80)
        const i = (y * w + x) * 4
        if (r > 40 && r < 44) data.set([10, 10, 10], i)
        else if (x > 90 && x < 110 && y > 70 && y < 90) data.set([215, 215, 215], i)
      }
    }
    data.set([0, 0, 0], (5 * w + 5) * 4)
    return { data, w, h }
  }

  it('crops to the drawing, drops shading and stray specks, and fills the box', () => {
    const { data, w, h } = drawing()
    const art = cleanLineArt(data, w, h, 400, 400)
    // The ring is about 90 px across with a little margin; enlarged to fit 400 px.
    expect(art.width).toBe(400)
    expect(art.height).toBe(400)
    const alpha = (x: number, y: number) => art.pixels[(y * art.width + x) * 4 + 3]
    expect(alpha(200, 200)).toBe(0) // the grey patch in the middle is gone
    expect(alpha(5, 5)).toBe(0)
    // Across the ring's left side: paper, solid line, paper, with crisp edges.
    let solid = 0
    let soft = 0
    for (let x = 0; x < 80; x++) {
      const a = alpha(x, 200)
      if (a === 255) solid++
      else if (a > 0) soft++
    }
    expect(solid).toBeGreaterThan(10)
    expect(soft).toBeLessThanOrEqual(4)
  })
})

describe('loadAiSettings', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the OpenAI key saved by the first version', async () => {
    const store = new Map([
      ['stickers.ai.key', 'sk-old'],
      ['stickers.ai.quality', 'low'],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    })
    const { loadAiSettings, saveAiSettings } = await import('../src/lib/ai-coloring')
    const loaded = loadAiSettings()
    expect(loaded).toMatchObject({ engine: 'openai', keys: { openai: 'sk-old', google: '', fal: '', quiver: '' }, quality: 'low' })
    saveAiSettings({ ...loaded, engine: 'kontext', keys: { ...loaded.keys, fal: ' fal-key ' } })
    expect(store.has('stickers.ai.key')).toBe(false)
    expect(loadAiSettings()).toMatchObject({ engine: 'kontext', keys: { openai: 'sk-old', fal: 'fal-key' } })
  })
})
