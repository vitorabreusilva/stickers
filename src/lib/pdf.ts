// A minimal PDF writer: pages of pictures. Enough for printing coloring books, without pulling in
// a PDF library.

export type PdfImage =
  /** A JPEG file, embedded as is. */
  | { kind: 'jpeg'; data: Uint8Array; width: number; height: number }
  /** 8-bit greyscale pixels, zlib-compressed (see deflate). */
  | { kind: 'gray'; data: Uint8Array; width: number; height: number }
  /** 8-bit RGB pixels, zlib-compressed. */
  | { kind: 'rgb'; data: Uint8Array; width: number; height: number }

/** A picture on a page, in millimetres from the page's top-left corner. */
export interface PdfPlacement {
  image: PdfImage
  x: number
  y: number
  width: number
  height: number
}

export interface PdfPage {
  widthMm: number
  heightMm: number
  images: PdfPlacement[]
}

const MM_TO_PT = 72 / 25.4

export const mmToPt = (mm: number) => mm * MM_TO_PT

/** zlib-compresses bytes, which is what PDF's FlateDecode filter reads. */
export async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** One picture filling each page of `widthMm` × `heightMm`. */
export function fullPages(images: PdfImage[], widthMm: number, heightMm: number): PdfPage[] {
  return images.map((image) => ({ widthMm, heightMm, images: [{ image, x: 0, y: 0, width: widthMm, height: heightMm }] }))
}

const COLOR_SPACES: Record<PdfImage['kind'], [string, string]> = {
  jpeg: ['DeviceRGB', 'DCTDecode'],
  gray: ['DeviceGray', 'FlateDecode'],
  rgb: ['DeviceRGB', 'FlateDecode'],
}

export function buildPdf(pages: PdfPage[]): Blob {
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
  const pt = (mm: number) => mmToPt(mm).toFixed(2)

  // Objects: 1 catalog, 2 page tree, then per page: the page, its contents, and its images.
  const pageIds: number[] = []
  let next = 3
  for (const page of pages) {
    pageIds.push(next)
    next += 2 + page.images.length
  }

  // A binary comment right after the header tells tools the file has 8-bit data.
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  pages.forEach((page, n) => {
    const id = pageIds[n]
    const names = page.images.map((_, i) => `/Im${i} ${id + 2 + i} 0 R`).join(' ')
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pt(page.widthMm)} ${pt(page.heightMm)}] /Resources << /XObject << ${names} >> >> /Contents ${id + 1} 0 R >>`,
    )
    // PDF measures up from the bottom-left corner.
    const draw = page.images
      .map((p, i) => `q ${pt(p.width)} 0 0 ${pt(p.height)} ${pt(p.x)} ${pt(page.heightMm - p.y - p.height)} cm /Im${i} Do Q`)
      .join('\n')
    const content = encoder.encode(draw)
    object(id + 1, `<< /Length ${content.length} >>`, content)
    page.images.forEach(({ image }, i) => {
      const [colorSpace, filter] = COLOR_SPACES[image.kind]
      object(
        id + 2 + i,
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /${colorSpace} /BitsPerComponent 8 /Filter /${filter} /Length ${image.data.length} >>`,
        image.data,
      )
    })
  })

  const count = next
  const xref = length
  write(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  write(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}
