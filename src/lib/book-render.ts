// Draws coloring pages and the book cover at print resolution, and exports them as PDF or prints them.

import { ART_BOX, collageLayout, DPI, FOOTER_BOX, fitBox, mmToPx, PAGE_MM, PAGE_PX } from './book-layout'
import { LINE_WIDTHS_MM, type ColoringDetail } from './coloring'
import type { ColoringReply, ColoringRequest } from './coloring-protocol'
import { bakeEffect } from './effect-render'
import type { StickerEffect } from './effects'
import { canvasToBlob, createCanvas } from './image'
import { buildPdf, deflate, type PdfImage } from './pdf'

const FONT = "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const INK = '#1f1830'
const INK_SOFT = '#8a8398'
// Stickers are at most 1024 px; anything bigger only costs time.
const MAX_SOURCE = 1024

let worker: Worker | null = null
let nextId = 1
interface ArtResult {
  pixels: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
}
const jobs = new Map<number, { resolve: (art: ArtResult) => void; reject: (err: Error) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('../workers/coloring.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }: MessageEvent<ColoringReply>) => {
    const job = jobs.get(data.id)
    if (!job) return
    jobs.delete(data.id)
    if (data.type === 'result') job.resolve(data)
    else job.reject(new Error(data.message))
  }
  w.onerror = (event) => {
    event.preventDefault()
    jobs.forEach((job) => job.reject(new Error(event.message || 'Coloring worker crashed')))
    jobs.clear()
    w.terminate()
    worker = null
  }
  worker = w
  return w
}

function context(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  return ctx
}

/** Line art for a sticker, sized to fill the drawing area of an A5 page. */
export async function drawColoringArt(sticker: Blob, detail: ColoringDetail): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(sticker)
  const scale = Math.min(1, MAX_SOURCE / Math.max(bitmap.width, bitmap.height))
  const source = createCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  const sctx = context(source)
  sctx.drawImage(bitmap, 0, 0, source.width, source.height)
  bitmap.close()
  const image = sctx.getImageData(0, 0, source.width, source.height)

  const mm = DPI / 25.4
  const widths = LINE_WIDTHS_MM[detail]
  const request: ColoringRequest = {
    id: nextId++,
    image,
    detail,
    width: ART_BOX.width,
    height: ART_BOX.height,
    style: { line: widths.line * mm, outline: widths.outline * mm },
  }
  const { pixels, width, height } = await new Promise<ArtResult>((resolve, reject) => {
    jobs.set(request.id, { resolve, reject })
    getWorker().postMessage(request, [image.data.buffer])
  })

  const art = createCanvas(width, height)
  context(art).putImageData(new ImageData(pixels, width, height), 0, 0)
  return art
}

/**
 * An A5 coloring page: the drawing, a "Colored by" line, and optionally the original sticker
 * small in the corner as a colour guide.
 */
export async function composePage(art: HTMLCanvasElement, guide: Blob | null): Promise<HTMLCanvasElement> {
  const page = createCanvas(PAGE_PX.width, PAGE_PX.height)
  const ctx = context(page)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, page.width, page.height)
  const box = fitBox(art.width / art.height, ART_BOX)
  ctx.drawImage(art, Math.round(box.x), Math.round(box.y))

  const { x, y, width, height } = FOOTER_BOX
  const baseline = y + height - mmToPx(3)
  ctx.fillStyle = INK_SOFT
  ctx.font = `600 ${mmToPx(3.2)}px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('Colored by', x, baseline)
  const lineStart = x + ctx.measureText('Colored by').width + mmToPx(2)
  const guideWidth = guide ? mmToPx(26) : 0
  ctx.strokeStyle = INK_SOFT
  ctx.lineWidth = mmToPx(0.25)
  ctx.beginPath()
  ctx.moveTo(lineStart, baseline)
  ctx.lineTo(x + width - guideWidth - (guide ? mmToPx(6) : 0), baseline)
  ctx.stroke()

  if (guide) {
    const bitmap = await createImageBitmap(guide)
    const spot = fitBox(bitmap.width / bitmap.height, { x: x + width - guideWidth, y, width: guideWidth, height })
    ctx.drawImage(bitmap, spot.x, spot.y, spot.width, spot.height)
    bitmap.close()
  }
  return page
}

export interface CoverSticker {
  blob: Blob
  effect?: StickerEffect
}

/** The book's cover: its title over a collage of every sticker in the book, in full colour. */
export async function composeCover(stickers: CoverSticker[], title: string, pageCount: number): Promise<HTMLCanvasElement> {
  const page = createCanvas(PAGE_PX.width, PAGE_PX.height)
  const ctx = context(page)
  ctx.fillStyle = '#fff6ec'
  ctx.fillRect(0, 0, page.width, page.height)
  // The app's dotted paper.
  ctx.fillStyle = 'rgba(122, 77, 255, 0.13)'
  const gap = mmToPx(5)
  for (let y = gap / 2; y < page.height; y += gap) {
    for (let x = gap / 2; x < page.width; x += gap) {
      ctx.beginPath()
      ctx.arc(x, y, mmToPx(0.35), 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Title, as a white-outlined sticker of its own, shrunk to fit.
  const margin = mmToPx(12)
  const maxWidth = page.width - 2 * margin
  let size = mmToPx(13)
  ctx.font = `800 ${size}px ${FONT}`
  const text = title.trim() || 'My Coloring Book'
  while (size > mmToPx(6) && ctx.measureText(text).width > maxWidth) {
    size -= 4
    ctx.font = `800 ${size}px ${FONT}`
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  const titleY = mmToPx(30)
  ctx.lineWidth = size * 0.28
  ctx.strokeStyle = '#fff'
  ctx.shadowColor = 'rgba(58, 10, 74, 0.25)'
  ctx.shadowBlur = mmToPx(1.5)
  ctx.shadowOffsetY = mmToPx(0.8)
  ctx.strokeText(text, page.width / 2, titleY, maxWidth)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = INK
  ctx.fillText(text, page.width / 2, titleY, maxWidth)
  ctx.font = `700 ${mmToPx(4.2)}px ${FONT}`
  ctx.fillStyle = '#ff3d7f'
  ctx.fillText(`Coloring book · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`, page.width / 2, titleY + mmToPx(10))
  ctx.textAlign = 'start'

  const images = await Promise.all(
    stickers.map(async ({ blob, effect }) => {
      const baked = effect && effect !== 'none' ? await bakeEffect(blob, effect).catch(() => blob) : blob
      return createImageBitmap(baked)
    }),
  )
  const area = { x: margin, y: mmToPx(50), width: page.width - 2 * margin, height: page.height - mmToPx(50) - margin }
  const placements = collageLayout(
    images.map((img) => img.width / img.height),
    area,
  )
  placements.forEach((p, i) => {
    ctx.save()
    ctx.translate(p.cx, p.cy)
    ctx.rotate(p.rotation)
    ctx.shadowColor = 'rgba(40, 20, 60, 0.28)'
    ctx.shadowBlur = mmToPx(2)
    ctx.shadowOffsetY = mmToPx(1)
    ctx.drawImage(images[i], -p.width / 2, -p.height / 2, p.width, p.height)
    ctx.restore()
    images[i].close()
  })
  return page
}

/** The page as greyscale pixels, compressed for the PDF. */
async function grayImage(png: Blob): Promise<PdfImage> {
  const bitmap = await createImageBitmap(png)
  const canvas = createCanvas(bitmap.width, bitmap.height)
  const ctx = context(canvas)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const gray = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0; i < gray.length; i++) gray[i] = data[i * 4]
  return { kind: 'gray', data: await deflate(gray), width: canvas.width, height: canvas.height }
}

/** A PDF of A5 pages, ready to print: an optional colour cover, then the coloring pages. */
export async function pagesToPdf(pages: Blob[], cover?: HTMLCanvasElement): Promise<Blob> {
  const images: PdfImage[] = []
  if (cover) {
    const jpeg = await canvasToBlob(cover, 'image/jpeg')
    images.push({ kind: 'jpeg', data: new Uint8Array(await jpeg.arrayBuffer()), width: cover.width, height: cover.height })
  }
  for (const page of pages) images.push(await grayImage(page))
  return buildPdf(images, PAGE_MM.width, PAGE_MM.height)
}

let cleanupPrint: (() => void) | null = null

/** Prints pictures one per A5 page through the browser's print dialog. */
export async function printPages(urls: string[]) {
  cleanupPrint?.()
  const style = document.createElement('style')
  style.textContent = `@page { size: ${PAGE_MM.width}mm ${PAGE_MM.height}mm; margin: 0 }`
  const sheet = document.createElement('div')
  sheet.className = 'print-sheet'
  const images = urls.map((url) => {
    const img = new Image()
    img.src = url
    img.alt = ''
    sheet.append(img)
    return img
  })
  document.head.append(style)
  document.body.append(sheet)
  document.documentElement.classList.add('printing')
  const cleanup = () => {
    style.remove()
    sheet.remove()
    document.documentElement.classList.remove('printing')
    window.removeEventListener('afterprint', cleanup)
    if (cleanupPrint === cleanup) cleanupPrint = null
  }
  cleanupPrint = cleanup
  await Promise.all(images.map((img) => img.decode().catch(() => {})))
  window.addEventListener('afterprint', cleanup)
  window.print()
}
