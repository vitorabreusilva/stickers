import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiSize, coloringPrompt, describeAiError, priceLabel, requestAiLineArt } from '../src/lib/ai-coloring'
import { cleanLineArt } from '../src/lib/line-art'

const settings = { key: ' sk-test ', model: 'gpt-image-1.5', quality: 'medium' as const }

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

  it('turns OpenAI errors into next steps', () => {
    expect(describeAiError(403, 'Your organization must be verified to use the model')).toContain('verified')
    expect(describeAiError(429, 'You exceeded your current quota, please check your plan and billing')).toContain('out of credit')
    expect(describeAiError(429, 'Rate limit reached')).toContain('busy')
    expect(describeAiError(400, 'Your request was rejected by the safety system')).toContain('declined')
    expect(describeAiError(400, 'Something odd')).toBe('OpenAI said: Something odd')
  })

  it('shows a price only for models it knows', () => {
    expect(priceLabel({ model: 'gpt-image-1.5', quality: 'medium' })).toBe('about $0.05')
    expect(priceLabel({ model: 'gpt-image-1-mini', quality: 'low' })).toBe('about $0.006')
    expect(priceLabel({ model: 'something-new', quality: 'low' })).toBeNull()
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
