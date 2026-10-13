// Draws coloring pages and every side of a coloring book at print resolution, and exports them as
// PDF or prints them.

import { aiSize, engineById, requestAiLineArt, type AiEngine, type AiSettings } from './ai-coloring'
import {
  ART_BOX,
  bookletSheets,
  bookSides,
  coverLayout,
  DPI,
  FOOTER_BOX,
  fitBox,
  GUIDE_BOX,
  hasLegacyGuide,
  mmToPx,
  PAGE_MM,
  PAGE_PX,
  type BookSide,
  type Box,
} from './book-layout'
import { COVER_PALETTES, DEFAULT_TITLE, type BookCover, type CoverPalette, type CoverStyle } from './books'
import { LINE_WIDTHS_MM, type ColoringDetail } from './coloring'
import type { ColoringReply, ColoringRequest } from './coloring-protocol'
import { bakeEffect } from './effect-render'
import type { StickerEffect } from './effects'
import type { Rect } from './geometry'
import { canvasToBlob, createCanvas } from './image'
import { buildPdf, deflate, fullPages, type PdfImage, type PdfPage } from './pdf'

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
  return runWorker({
    id: nextId++,
    type: 'trace',
    image,
    detail,
    width: ART_BOX.width,
    height: ART_BOX.height,
    style: { line: widths.line * mm, outline: widths.outline * mm },
  })
}

async function runWorker(request: ColoringRequest): Promise<HTMLCanvasElement> {
  const { pixels, width, height } = await new Promise<ArtResult>((resolve, reject) => {
    jobs.set(request.id, { resolve, reject })
    getWorker().postMessage(request, [request.image.data.buffer])
  })
  const art = createCanvas(width, height)
  context(art).putImageData(new ImageData(pixels, width, height), 0, 0)
  return art
}

/**
 * Line art for a sticker drawn by an AI image model, tidied and sized to fill the drawing area
 * of an A5 page. The sticker is sent on white, shaped like the picture that comes back.
 */
export async function drawAiColoringArt(
  sticker: Blob,
  detail: ColoringDetail,
  settings: AiSettings,
  signal?: AbortSignal,
  engine: AiEngine = engineById(settings.engine),
): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(sticker)
  const size = aiSize(bitmap.width / bitmap.height)
  const [width, height] = size.split('x').map(Number)
  const input = createCanvas(width, height)
  const ictx = context(input)
  ictx.fillStyle = '#fff'
  ictx.fillRect(0, 0, width, height)
  const spot = fitBox(bitmap.width / bitmap.height, { x: width * 0.06, y: height * 0.06, width: width * 0.88, height: height * 0.88 })
  ictx.drawImage(bitmap, spot.x, spot.y, spot.width, spot.height)
  bitmap.close()

  const drawn = await requestAiLineArt(await canvasToBlob(input), size, detail, settings, signal, engine)
  const canvas = drawn.type === 'image/svg+xml' ? await rasterizeSvg(drawn, ART_BOX.width, ART_BOX.height) : await toCanvas(drawn)
  const cctx = context(canvas)
  return runWorker({
    id: nextId++,
    type: 'clean',
    image: cctx.getImageData(0, 0, canvas.width, canvas.height),
    width: ART_BOX.width,
    height: ART_BOX.height,
  })
}

async function toCanvas(image: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image)
  const canvas = createCanvas(bitmap.width, bitmap.height)
  context(canvas).drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

/** Draws an SVG on white at the largest size that fits `width` × `height`, so lines stay crisp. */
async function rasterizeSvg(svg: Blob, width: number, height: number): Promise<HTMLCanvasElement> {
  const doc = new DOMParser().parseFromString(await svg.text(), 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg') throw new Error('The vector drawing could not be read')
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const ownWidth = box.length === 4 && box[2] > 0 ? box[2] : parseFloat(root.getAttribute('width') ?? '') || 1024
  const ownHeight = box.length === 4 && box[3] > 0 ? box[3] : parseFloat(root.getAttribute('height') ?? '') || 1024
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${ownWidth} ${ownHeight}`)
  const scale = Math.min(width / ownWidth, height / ownHeight)
  const outWidth = Math.max(1, Math.round(ownWidth * scale))
  const outHeight = Math.max(1, Math.round(ownHeight * scale))
  root.setAttribute('width', String(outWidth))
  root.setAttribute('height', String(outHeight))

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const canvas = createCanvas(outWidth, outHeight)
    const ctx = context(canvas)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, outWidth, outHeight)
    ctx.drawImage(img, 0, 0, outWidth, outHeight)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * An A5 coloring page: the drawing, and optionally the original sticker small in the bottom corner
 * as a colour guide. Running heads and page numbers are added when the page goes in a book.
 */
export async function composePage(art: HTMLCanvasElement, guide: Blob | null): Promise<HTMLCanvasElement> {
  const page = createCanvas(PAGE_PX.width, PAGE_PX.height)
  const ctx = context(page)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, page.width, page.height)
  const box = fitBox(art.width / art.height, ART_BOX)
  ctx.drawImage(art, Math.round(box.x), Math.round(box.y))

  if (guide) {
    const bitmap = await createImageBitmap(guide)
    const spot = fitBox(bitmap.width / bitmap.height, GUIDE_BOX)
    ctx.drawImage(bitmap, spot.x, spot.y, spot.width, spot.height)
    bitmap.close()
  }
  return page
}

// The app's star, from public/favicon.svg (512 × 512, tilted 10° to the left).
const STAR = 'M256 98 L301 195 L404 208 L328 280 L348 383 L256 332 L164 383 L184 280 L108 208 L211 195 Z'
const SMILE = 'M234 296 Q256 316 278 296'

/**
 * The app's mark, `size` across, centred on (cx, cy). 'color' is the app icon; 'line' is the star
 * alone as line art, for the inside pages, where it can be coloured in too.
 */
function drawLogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, mode: 'color' | 'line') {
  const star = new Path2D(STAR)
  const smile = new Path2D(SMILE)
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(size / 512, size / 512)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (mode === 'color') {
    const bg = ctx.createLinearGradient(0, 0, 512, 512)
    bg.addColorStop(0, '#ff5c93')
    bg.addColorStop(1, '#7a4dff')
    ctx.fillStyle = bg
    ctx.beginPath()
    ctx.roundRect(0, 0, 512, 512, 116)
    ctx.fill()
  }
  ctx.translate(256, 256)
  ctx.rotate((-10 * Math.PI) / 180)
  ctx.translate(-256, -256)
  if (mode === 'color') {
    ctx.save()
    ctx.translate(0, 12)
    ctx.fillStyle = ctx.strokeStyle = 'rgba(58, 10, 74, 0.28)'
    ctx.lineWidth = 44
    ctx.stroke(star)
    ctx.fill(star)
    ctx.restore()
    ctx.lineWidth = 44
    ctx.strokeStyle = '#fff'
    ctx.stroke(star)
    ctx.fillStyle = '#ffd23f'
    ctx.fill(star)
  } else {
    ctx.fillStyle = '#fff'
    ctx.fill(star)
    ctx.lineWidth = 22
    ctx.strokeStyle = INK
    ctx.stroke(star)
  }
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.ellipse(232, 258, 13, 17, 0, 0, Math.PI * 2)
  ctx.ellipse(280, 258, 13, 17, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 12
  ctx.strokeStyle = INK
  ctx.stroke(smile)
  ctx.restore()
}

/** Paper with the app's dots, in a cover colour. */
function drawCoverPaper(ctx: CanvasRenderingContext2D, palette: CoverPalette) {
  ctx.fillStyle = palette.paper
  ctx.fillRect(0, 0, PAGE_PX.width, PAGE_PX.height)
  ctx.fillStyle = palette.dots
  const gap = mmToPx(5)
  for (let y = gap / 2; y < PAGE_PX.height; y += gap) {
    for (let x = gap / 2; x < PAGE_PX.width; x += gap) {
      ctx.beginPath()
      ctx.arc(x, y, mmToPx(0.35), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Sets letter spacing where the canvas supports it (it's only decoration). */
function track(ctx: CanvasRenderingContext2D, em: number, size: number) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(em * size).toFixed(1)}px`
}

export interface CoverSticker {
  /** Identifies the picture, so previews know when the cover changed. */
  key: string
  blob: Blob
  effect?: StickerEffect
}

/** A sticker with its effect baked in, ready to draw. */
async function stickerBitmap({ blob, effect }: CoverSticker): Promise<ImageBitmap> {
  const baked = effect && effect !== 'none' ? await bakeEffect(blob, effect).catch(() => blob) : blob
  return createImageBitmap(baked)
}

/** `hex` (#rrggbb) at `alpha`. */
function withAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * The book's cover: its title over its stickers in full colour, laid out in the chosen style, or
 * over one sticker, or over the picture that sticker was cut from.
 */
async function drawCover(ctx: CanvasRenderingContext2D, book: BookContents) {
  const { stickers, cover } = book
  const palette = COVER_PALETTES[book.style.background]
  drawCoverPaper(ctx, palette)
  if (cover?.photo) {
    await drawCoverPhoto(ctx, cover.photo, palette)
    drawCoverTitle(ctx, book.title, palette, true)
    return
  }
  drawCoverTitle(ctx, book.title, palette, false)

  const margin = mmToPx(12)
  const area = { x: margin, y: mmToPx(50), width: PAGE_PX.width - 2 * margin, height: PAGE_PX.height - mmToPx(50) - margin }
  if (cover) {
    const image = await stickerBitmap(cover.sticker)
    if (cover.kind === 'stamp') drawStamp(ctx, image, area, palette)
    else drawSingleSticker(ctx, image, area)
    image.close()
    return
  }
  if (!stickers.length) {
    // Nothing to show yet: the app's star stands in.
    ctx.globalAlpha = 0.9
    drawLogo(ctx, area.x + area.width / 2, area.y + area.height * 0.42, mmToPx(56), 'color')
    ctx.globalAlpha = 1
    return
  }

  const images = await Promise.all(stickers.map(stickerBitmap))
  const placements = coverLayout(
    book.style.layout,
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
}

/** The title, as a sticker of its own with an outline, shrunk to fit; `onPhoto` keeps it readable over a picture. */
function drawCoverTitle(ctx: CanvasRenderingContext2D, title: string, palette: CoverPalette, onPhoto: boolean) {
  const margin = mmToPx(12)
  const maxWidth = PAGE_PX.width - 2 * margin
  let size = mmToPx(13)
  ctx.font = `800 ${size}px ${FONT}`
  const text = title.trim() || DEFAULT_TITLE
  while (size > mmToPx(6) && ctx.measureText(text).width > maxWidth) {
    size -= 4
    ctx.font = `800 ${size}px ${FONT}`
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  const titleY = mmToPx(30)
  ctx.lineWidth = size * 0.28
  ctx.strokeStyle = palette.outline
  ctx.shadowColor = onPhoto ? 'rgba(20, 10, 30, 0.45)' : 'rgba(58, 10, 74, 0.25)'
  ctx.shadowBlur = mmToPx(onPhoto ? 2.5 : 1.5)
  ctx.shadowOffsetY = mmToPx(0.8)
  ctx.strokeText(text, PAGE_PX.width / 2, titleY, maxWidth)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = palette.ink
  ctx.fillText(text, PAGE_PX.width / 2, titleY, maxWidth)
  const small = mmToPx(3.6)
  ctx.font = `800 ${small}px ${FONT}`
  track(ctx, 0.02, small)
  if (onPhoto) {
    ctx.lineWidth = small * 0.45
    ctx.strokeText('A coloring book', PAGE_PX.width / 2, titleY + mmToPx(10))
  }
  ctx.fillStyle = palette.accent
  ctx.fillText('A coloring book', PAGE_PX.width / 2, titleY + mmToPx(10))
  track(ctx, 0, small)
  ctx.textAlign = 'start'
}

/**
 * The picture a sticker was cut from, filling the whole cover. It's framed on the sticker, a little
 * below the middle so the title doesn't sit on it, and the cover colour washes in at the top.
 */
async function drawCoverPhoto(ctx: CanvasRenderingContext2D, photo: CoverPhoto, palette: CoverPalette) {
  const image = await createImageBitmap(photo.blob)
  const { width: W, height: H } = PAGE_PX
  const fill = Math.max(W / image.width, H / image.height)
  // Zoom in on a small sticker a little, but not so far the picture goes soft.
  const scale = Math.min(fill * 1.5, Math.max(fill, (W * 0.7) / Math.max(1, photo.rect.width * image.width)))
  const fx = (photo.rect.x + photo.rect.width / 2) * image.width * scale
  const fy = (photo.rect.y + photo.rect.height / 2) * image.height * scale
  const x = Math.min(0, Math.max(W - image.width * scale, W / 2 - fx))
  const y = Math.min(0, Math.max(H - image.height * scale, H * 0.58 - fy))
  ctx.drawImage(image, x, y, image.width * scale, image.height * scale)
  image.close()
  const wash = ctx.createLinearGradient(0, 0, 0, H * 0.4)
  wash.addColorStop(0, withAlpha(palette.paper, 0.75))
  wash.addColorStop(0.55, withAlpha(palette.paper, 0.3))
  wash.addColorStop(1, withAlpha(palette.paper, 0))
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, W, H * 0.4)
}

/** One sticker, big, filling the space under the title. */
function drawSingleSticker(ctx: CanvasRenderingContext2D, image: ImageBitmap, area: Box) {
  const scale = Math.min((area.width * 0.94) / image.width, (area.height * 0.9) / image.height)
  const w = image.width * scale
  const h = image.height * scale
  ctx.save()
  ctx.translate(area.x + area.width / 2, area.y + area.height * 0.47)
  ctx.rotate((-3 * Math.PI) / 180)
  ctx.shadowColor = 'rgba(40, 20, 60, 0.3)'
  ctx.shadowBlur = mmToPx(3)
  ctx.shadowOffsetY = mmToPx(1.5)
  ctx.drawImage(image, -w / 2, -h / 2, w, h)
  ctx.restore()
}

/** One sticker on a postage stamp: white paper with perforated edges, a tinted panel, a slight tilt. */
function drawStamp(ctx: CanvasRenderingContext2D, image: ImageBitmap, area: Box, palette: CoverPalette) {
  const aspect = Math.min(1.25, Math.max(0.75, image.width / image.height))
  let w = area.width * 0.8
  let h = w / aspect
  if (h > area.height * 0.84) {
    h = area.height * 0.84
    w = h * aspect
  }
  w = Math.round(w)
  h = Math.round(h)
  const stamp = createCanvas(w, h)
  const s = context(stamp)
  s.fillStyle = '#fffdf8'
  s.fillRect(0, 0, w, h)

  // Perforations: half-holes punched evenly along every edge, with one in each corner.
  const radius = mmToPx(1.7)
  s.globalCompositeOperation = 'destination-out'
  s.beginPath()
  const punch = (length: number, at: (t: number) => [number, number]) => {
    const holes = Math.max(2, Math.round(length / mmToPx(5)))
    for (let i = 0; i <= holes; i++) {
      const [x, y] = at((i / holes) * length)
      s.moveTo(x + radius, y)
      s.arc(x, y, radius, 0, Math.PI * 2)
    }
  }
  punch(w, (t) => [t, 0])
  punch(w, (t) => [t, h])
  punch(h, (t) => [0, t])
  punch(h, (t) => [w, t])
  s.fill()
  s.globalCompositeOperation = 'source-over'

  // The picture panel, with a fine frame like a printed stamp.
  const border = mmToPx(5.5)
  const panel = { x: border, y: border, width: w - 2 * border, height: h - 2 * border - mmToPx(4) }
  s.fillStyle = palette.paper
  s.fillRect(panel.x, panel.y, panel.width, panel.height)
  s.fillStyle = palette.dots
  const gap = mmToPx(3.5)
  for (let y = panel.y + gap / 2; y < panel.y + panel.height; y += gap) {
    for (let x = panel.x + gap / 2; x < panel.x + panel.width; x += gap) {
      s.beginPath()
      s.arc(x, y, mmToPx(0.3), 0, Math.PI * 2)
      s.fill()
    }
  }
  s.strokeStyle = withAlpha(palette.accent, 0.55)
  s.lineWidth = mmToPx(0.35)
  s.strokeRect(panel.x - mmToPx(1), panel.y - mmToPx(1), panel.width + mmToPx(2), panel.height + mmToPx(2))
  const pad = mmToPx(4)
  const fit = Math.min((panel.width - 2 * pad) / image.width, (panel.height - 2 * pad) / image.height)
  const iw = image.width * fit
  const ih = image.height * fit
  s.shadowColor = 'rgba(40, 20, 60, 0.25)'
  s.shadowBlur = mmToPx(1.2)
  s.shadowOffsetY = mmToPx(0.5)
  s.drawImage(image, panel.x + (panel.width - iw) / 2, panel.y + (panel.height - ih) / 2, iw, ih)
  s.shadowColor = 'transparent'

  // The little line of print under the picture.
  const small = mmToPx(2.6)
  s.font = `800 ${small}px ${FONT}`
  track(s, 0.12, small)
  s.fillStyle = INK
  s.globalAlpha = 0.75
  s.textAlign = 'center'
  s.textBaseline = 'middle'
  s.fillText('COLOR ME', w / 2, h - border - mmToPx(1.6))
  s.globalAlpha = 1

  ctx.save()
  ctx.translate(area.x + area.width / 2, area.y + area.height * 0.47)
  ctx.rotate((-4 * Math.PI) / 180)
  ctx.shadowColor = 'rgba(40, 20, 60, 0.3)'
  ctx.shadowBlur = mmToPx(3)
  ctx.shadowOffsetY = mmToPx(1.5)
  ctx.drawImage(stamp, -w / 2, -h / 2)
  ctx.restore()
}

/** The back cover: the cover's paper, with the app's mark at the foot. */
function drawBackCover(ctx: CanvasRenderingContext2D, title: string, style: CoverStyle) {
  const palette = COVER_PALETTES[style.background]
  drawCoverPaper(ctx, palette)
  const cx = PAGE_PX.width / 2
  const logoY = PAGE_PX.height - mmToPx(42)
  drawLogo(ctx, cx, logoY, mmToPx(16), 'color')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = palette.ink
  ctx.font = `800 ${mmToPx(4.2)}px ${FONT}`
  ctx.fillText(title.trim() || DEFAULT_TITLE, cx, logoY + mmToPx(16), PAGE_PX.width - mmToPx(24))
  const small = mmToPx(2.8)
  ctx.font = `700 ${small}px ${FONT}`
  track(ctx, 0.02, small)
  ctx.globalAlpha = 0.7
  ctx.fillText('Made with stickers', cx, logoY + mmToPx(22))
  ctx.globalAlpha = 1
  track(ctx, 0, small)
  ctx.textAlign = 'start'
}

function whitePaper(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, PAGE_PX.width, PAGE_PX.height)
}

/** The inside of the front cover: a nameplate to write in. */
function drawInsideCover(ctx: CanvasRenderingContext2D) {
  whitePaper(ctx)
  const cx = PAGE_PX.width / 2
  const top = mmToPx(58)
  drawLogo(ctx, cx, top, mmToPx(26), 'line')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = INK
  ctx.font = `800 ${mmToPx(6)}px ${FONT}`
  ctx.fillText('This book belongs to', cx, top + mmToPx(28))
  ctx.textAlign = 'start'
  ctx.strokeStyle = INK_SOFT
  ctx.lineWidth = mmToPx(0.3)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - mmToPx(48), top + mmToPx(48))
  ctx.lineTo(cx + mmToPx(48), top + mmToPx(48))
  ctx.stroke()
}

/**
 * A book page's running head and number: the book's title along the top on the outside edge, a
 * hairline to the app's star on the inside edge, and the page number in a bubble at the foot.
 */
function drawPageFurniture(ctx: CanvasRenderingContext2D, title: string, folio: number) {
  const recto = folio % 2 === 1
  const margin = mmToPx(12)
  const outer = recto ? PAGE_PX.width - margin : margin
  const inner = recto ? margin : PAGE_PX.width - margin
  const dir = recto ? -1 : 1 // from the outer edge inwards

  const headY = mmToPx(8)
  const size = mmToPx(2.8)
  ctx.font = `800 ${size}px ${FONT}`
  track(ctx, 0.02, size)
  ctx.fillStyle = INK_SOFT
  ctx.textBaseline = 'middle'
  ctx.textAlign = recto ? 'right' : 'left'
  const text = title.trim() || DEFAULT_TITLE
  const maxText = PAGE_PX.width - 2 * margin - mmToPx(14)
  ctx.fillText(text, outer, headY, maxText)
  const textWidth = Math.min(ctx.measureText(text).width, maxText)
  track(ctx, 0, size)

  const star = mmToPx(4.6)
  const ruleFrom = outer + dir * (textWidth + mmToPx(3))
  const ruleTo = inner - dir * (star + mmToPx(1.5))
  if ((ruleTo - ruleFrom) * dir > mmToPx(4)) {
    ctx.strokeStyle = '#cfcad8'
    ctx.lineWidth = mmToPx(0.25)
    ctx.beginPath()
    ctx.moveTo(ruleFrom, headY)
    ctx.lineTo(ruleTo, headY)
    ctx.stroke()
  }
  drawLogo(ctx, inner - (dir * star) / 2, headY, star, 'line')

  // The page number at the outside corner of the foot.
  const r = mmToPx(3.4)
  const fx = outer + dir * r
  const fy = PAGE_PX.height - mmToPx(7.5)
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = INK
  ctx.lineWidth = mmToPx(0.3)
  ctx.beginPath()
  ctx.arc(fx, fy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.font = `800 ${mmToPx(folio > 99 ? 2.4 : 3)}px ${FONT}`
  ctx.fillText(String(folio), fx, fy + mmToPx(0.2))
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
}

/** A spare page to round the book up to whole sheets: an empty frame to draw in. */
function drawBlankPage(ctx: CanvasRenderingContext2D, title: string, folio: number) {
  whitePaper(ctx)
  const box = { ...ART_BOX, height: ART_BOX.height + mmToPx(6) }
  ctx.strokeStyle = '#d9d4e2'
  ctx.lineWidth = mmToPx(0.4)
  ctx.setLineDash([mmToPx(2), mmToPx(2)])
  ctx.beginPath()
  ctx.roundRect(box.x, box.y, box.width, box.height, mmToPx(5))
  ctx.stroke()
  ctx.setLineDash([])
  const size = mmToPx(3.2)
  ctx.font = `800 ${size}px ${FONT}`
  ctx.fillStyle = '#b9b3c4'
  ctx.textAlign = 'center'
  ctx.fillText('Draw your own sticker here!', box.x + box.width / 2, box.y + mmToPx(10))
  ctx.textAlign = 'start'
  drawPageFurniture(ctx, title, folio)
}

// Whether each stored page has a colour guide, by page id; pages never change.
const guides = new Map<string, Promise<boolean>>()

/**
 * Pages made before the book layout had a "Colored by" line in the footer. Looks at the colour
 * guide's corner to tell whether the page has one, so the rest of the footer can be wiped.
 */
function pageHasGuide(id: string, page: Blob): Promise<boolean> {
  let known = guides.get(id)
  if (!known) {
    known = (async () => {
      const { x, y, width, height } = GUIDE_BOX
      const bitmap = await createImageBitmap(page, x, y, width, height)
      const canvas = createCanvas(width, height)
      const ctx = context(canvas)
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      return hasLegacyGuide(ctx.getImageData(0, 0, width, height).data, width, height)
    })()
    known.catch(() => guides.delete(id))
    guides.set(id, known)
  }
  return known
}

/** A stored coloring page, with the old footer line wiped, and the colour guide too if it's hidden. */
async function drawStoredPage(ctx: CanvasRenderingContext2D, { id, page, hideGuide }: StoredPage, scale: number) {
  const [bitmap, guide] = await Promise.all([
    scale < 1
      ? createImageBitmap(page, {
          resizeWidth: Math.round(PAGE_PX.width * scale),
          resizeHeight: Math.round(PAGE_PX.height * scale),
          resizeQuality: 'high',
        })
      : createImageBitmap(page),
    hideGuide ? false : pageHasGuide(id, page),
  ])
  ctx.drawImage(bitmap, 0, 0, PAGE_PX.width, PAGE_PX.height)
  bitmap.close()
  ctx.fillStyle = '#fff'
  const right = guide ? GUIDE_BOX.x - mmToPx(0.5) : PAGE_PX.width
  ctx.fillRect(0, FOOTER_BOX.y, right, PAGE_PX.height - FOOTER_BOX.y)
}

export interface StoredPage {
  id: string
  page: Blob
  hideGuide?: boolean
}

/** The picture a sticker was cut from, and where the sticker sits in it (as fractions). */
export interface CoverPhoto {
  blob: Blob
  rect: Rect
}

/** What it takes to draw any side of a book. */
export interface BookContents {
  title: string
  style: CoverStyle
  pages: StoredPage[]
  stickers: CoverSticker[]
  /** One sticker on the cover instead of the layout; with `photo`, its picture fills the cover. */
  cover?: { kind: BookCover['kind']; sticker: CoverSticker; photo?: CoverPhoto }
}

/** Draws one side of the book. `scale` < 1 makes a smaller picture for previews. */
export async function renderSide(side: BookSide, book: BookContents, scale = 1): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(Math.round(PAGE_PX.width * scale), Math.round(PAGE_PX.height * scale))
  const ctx = context(canvas)
  ctx.scale(scale, scale)
  ctx.imageSmoothingQuality = 'high'
  switch (side.kind) {
    case 'cover':
      await drawCover(ctx, book)
      break
    case 'inside-cover':
      drawInsideCover(ctx)
      break
    case 'page': {
      await drawStoredPage(ctx, book.pages[side.index], scale)
      drawPageFurniture(ctx, book.title, side.folio)
      break
    }
    case 'blank':
      drawBlankPage(ctx, book.title, side.folio)
      break
    case 'inside-back':
      whitePaper(ctx)
      break
    case 'back':
      drawBackCover(ctx, book.title, book.style)
  }
  return canvas
}

/** The page's pixels for the PDF: greyscale unless it has colour in it (a colour guide). */
async function pdfImage(canvas: HTMLCanvasElement): Promise<PdfImage> {
  const ctx = context(canvas)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = canvas.width * canvas.height
  let colored = false
  for (let i = 0; i < pixels && !colored; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    colored = Math.max(r, g, b) - Math.min(r, g, b) > 24
  }
  if (!colored) {
    const gray = new Uint8Array(pixels)
    for (let i = 0; i < pixels; i++) gray[i] = data[i * 4 + 1]
    return { kind: 'gray', data: await deflate(gray), width: canvas.width, height: canvas.height }
  }
  const rgb = new Uint8Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    rgb[i * 3] = data[i * 4]
    rgb[i * 3 + 1] = data[i * 4 + 1]
    rgb[i * 3 + 2] = data[i * 4 + 2]
  }
  return { kind: 'rgb', data: await deflate(rgb), width: canvas.width, height: canvas.height }
}

async function jpegImage(canvas: HTMLCanvasElement): Promise<PdfImage> {
  const jpeg = await canvasToBlob(canvas, 'image/jpeg')
  return { kind: 'jpeg', data: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height }
}

/** Coloring pages as a PDF of A5 pages, as they are. */
export async function pagesToPdf(pages: Blob[]): Promise<Blob> {
  const images: PdfImage[] = []
  for (const page of pages) {
    const bitmap = await createImageBitmap(page)
    const canvas = createCanvas(bitmap.width, bitmap.height)
    const ctx = context(canvas)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    images.push(await pdfImage(canvas))
  }
  return buildPdf(fullPages(images, PAGE_MM.width, PAGE_MM.height))
}

/** Every side of the book at print resolution, one at a time, for printing or the PDF. */
async function* renderBook(book: BookContents) {
  for (const side of bookSides(book.pages.length)) yield { side, canvas: await renderSide(side, book) }
}

const A4_LANDSCAPE = { width: 297, height: 210 }

/**
 * The whole book as a PDF. 'pages' is one A5 page per side in reading order, for a print shop or
 * a printer that makes booklets itself. 'booklet' puts two pages on each A4 sheet in folding order:
 * print it double-sided, flipping on the short edge, then stack the sheets and fold them in half.
 */
export async function bookToPdf(book: BookContents, layout: 'pages' | 'booklet'): Promise<Blob> {
  const images: PdfImage[] = []
  for await (const { side, canvas } of renderBook(book)) {
    images.push(side.kind === 'cover' || side.kind === 'back' ? await jpegImage(canvas) : await pdfImage(canvas))
  }
  if (layout === 'pages') return buildPdf(fullPages(images, PAGE_MM.width, PAGE_MM.height))
  const left = (A4_LANDSCAPE.width - 2 * PAGE_MM.width) / 2
  const pages: PdfPage[] = bookletSheets(images.length).map(([l, r]) => ({
    widthMm: A4_LANDSCAPE.width,
    heightMm: A4_LANDSCAPE.height,
    images: [
      { image: images[l], x: left, y: 0, width: PAGE_MM.width, height: PAGE_MM.height },
      { image: images[r], x: left + PAGE_MM.width, y: 0, width: PAGE_MM.width, height: PAGE_MM.height },
    ],
  }))
  return buildPdf(pages)
}

/** Prints the whole book, one A5 page per side in reading order. */
export async function printBook(book: BookContents) {
  const urls: string[] = []
  try {
    for await (const { canvas } of renderBook(book)) urls.push(URL.createObjectURL(await canvasToBlob(canvas)))
    await printPages(urls)
  } finally {
    // The print dialog has the pictures by the time it's closed.
    setTimeout(() => urls.forEach((url) => URL.revokeObjectURL(url)), 60_000)
  }
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
