import { describe, expect, it } from 'vitest'
import { buildPdf, deflate, fullPages } from '../src/lib/pdf'

describe('buildPdf', () => {
  it('writes A5 pages with a valid cross-reference table', async () => {
    const gray = await deflate(new Uint8Array(4 * 6).fill(255))
    const blob = buildPdf(
      fullPages(
        [
          { kind: 'jpeg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 2, height: 3 },
          { kind: 'gray', data: gray, width: 4, height: 6 },
        ],
        148,
        210,
      ),
    )
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('/Count 2')
    expect(text.match(/\/MediaBox \[0 0 419\.53 595\.28\]/g)).toHaveLength(2)
    expect(text).toContain('/DCTDecode')
    expect(text).toContain('/DeviceGray /BitsPerComponent 8 /Filter /FlateDecode')

    // Every xref entry points at the start of its object.
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(entries).toHaveLength(8)
    entries.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true))
  })

  it('places two pages side by side on a landscape A4 sheet', async () => {
    const image = { kind: 'rgb' as const, data: await deflate(new Uint8Array(3).fill(255)), width: 1, height: 1 }
    const blob = buildPdf([
      {
        widthMm: 297,
        heightMm: 210,
        images: [
          { image, x: 0.5, y: 0, width: 148, height: 210 },
          { image, x: 148.5, y: 0, width: 148, height: 210 },
        ],
      },
    ])
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()))
    expect(text).toContain('/MediaBox [0 0 841.89 595.28]')
    expect(text).toContain('/XObject << /Im0 5 0 R /Im1 6 0 R >>')
    expect(text).toContain('q 419.53 0 0 595.28 1.42 0.00 cm /Im0 Do Q\nq 419.53 0 0 595.28 420.94 0.00 cm /Im1 Do Q')
    expect(text).toContain('/DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode')
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1])
    const entries = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(entries).toHaveLength(6)
    entries.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true))
  })

  it('compresses greyscale pages in a form PDF readers inflate', async () => {
    const pixels = new Uint8Array(1000).fill(255)
    const packed = await deflate(pixels)
    expect(packed[0]).toBe(0x78) // zlib header
    const back = await new Response(new Blob([packed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()
    expect(new Uint8Array(back)).toEqual(pixels)
  })
})
