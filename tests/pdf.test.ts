import { describe, expect, it } from 'vitest'
import { buildPdf, deflate } from '../src/lib/pdf'

describe('buildPdf', () => {
  it('writes A5 pages with a valid cross-reference table', async () => {
    const gray = await deflate(new Uint8Array(4 * 6).fill(255))
    const blob = buildPdf(
      [
        { kind: 'jpeg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 2, height: 3 },
        { kind: 'gray', data: gray, width: 4, height: 6 },
      ],
      148,
      210,
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

  it('compresses greyscale pages in a form PDF readers inflate', async () => {
    const pixels = new Uint8Array(1000).fill(255)
    const packed = await deflate(pixels)
    expect(packed[0]).toBe(0x78) // zlib header
    const back = await new Response(new Blob([packed as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()
    expect(new Uint8Array(back)).toEqual(pixels)
  })
})
