// A minimal PDF writer: one full-page picture per page. Enough for printing coloring pages,
// without pulling in a PDF library.

export type PdfImage =
  /** A JPEG file, embedded as is. */
  | { kind: 'jpeg'; data: Uint8Array; width: number; height: number }
  /** 8-bit greyscale pixels, zlib-compressed (see deflate). */
  | { kind: 'gray'; data: Uint8Array; width: number; height: number }

const MM_TO_PT = 72 / 25.4

export const mmToPt = (mm: number) => mm * MM_TO_PT

/** zlib-compresses bytes, which is what PDF's FlateDecode filter reads. */
export async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Builds a PDF with each image filling one page of `widthMm` × `heightMm`. */
export function buildPdf(pages: PdfImage[], widthMm: number, heightMm: number): Blob {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length
    write(`${id} 0 obj\n${body}\n`)
    if (stream) {
      write('stream\n')
      write(stream)
      write('\nendstream\n')
    }
    write('endobj\n')
  }

  const w = mmToPt(widthMm).toFixed(2)
  const h = mmToPt(heightMm).toFixed(2)
  // Objects: 1 catalog, 2 page tree, then three per page (page, contents, image).
  const pageId = (n: number) => 3 + n * 3

  // A binary comment right after the header tells tools the file has 8-bit data.
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${pages.map((_, n) => `${pageId(n)} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  pages.forEach((image, n) => {
    const id = pageId(n)
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    )
    const content = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`)
    object(id + 1, `<< /Length ${content.length} >>`, content)
    const [colorSpace, filter] = image.kind === 'jpeg' ? ['DeviceRGB', 'DCTDecode'] : ['DeviceGray', 'FlateDecode']
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${colorSpace} /BitsPerComponent 8 /Filter /${filter} /Length ${image.data.length} >>`,
      image.data,
    )
  })

  const count = pageId(pages.length)
  const xref = length
  write(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}
