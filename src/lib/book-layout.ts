// Page geometry for the coloring book: A5 pages at print resolution, and the sticker collage on the
// cover. Pure math, so it runs in tests.

export const PAGE_MM = { width: 148, height: 210 }
export const DPI = 300

export const mmToPx = (mm: number) => Math.round((mm * DPI) / 25.4)

/** A5 at 300 dpi: 1748 × 2480 px. */
export const PAGE_PX = { width: mmToPx(PAGE_MM.width), height: mmToPx(PAGE_MM.height) }

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

const MARGIN_MM = 12
const FOOTER_MM = 20

/** Where the drawing goes on a coloring page, leaving margins and a footer for the name line. */
export const ART_BOX: Box = {
  x: mmToPx(MARGIN_MM),
  y: mmToPx(MARGIN_MM),
  width: PAGE_PX.width - 2 * mmToPx(MARGIN_MM),
  height: PAGE_PX.height - 2 * mmToPx(MARGIN_MM) - mmToPx(FOOTER_MM),
}

/** The footer strip under the drawing. */
export const FOOTER_BOX: Box = {
  x: ART_BOX.x,
  y: ART_BOX.y + ART_BOX.height + mmToPx(4),
  width: ART_BOX.width,
  height: mmToPx(FOOTER_MM - 4),
}

/** The largest box of `aspect` (width / height) that fits in `box`, centred. */
export function fitBox(aspect: number, box: Box): Box {
  let width = box.width
  let height = width / aspect
  if (height > box.height) {
    height = box.height
    width = height * aspect
  }
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}

export interface Placement {
  /** Centre of the sticker. */
  cx: number
  cy: number
  width: number
  height: number
  /** Radians, clockwise. */
  rotation: number
}

/** Small deterministic PRNG, so a cover looks the same every time it's drawn. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Size of a w × h box rotated by `angle`, fitted into `cellW` × `cellH`. */
function fitRotated(aspect: number, angle: number, cellW: number, cellH: number) {
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  // Bounding box of a 1-tall sticker after rotation.
  const bw = aspect * cos + sin
  const bh = aspect * sin + cos
  const height = Math.min(cellW / bw, cellH / bh)
  return { width: height * aspect, height }
}

/**
 * Scatters stickers over `box` like a sticker-bombed notebook cover: a grid chosen to cover as
 * much of the box as possible, with each sticker tilted and nudged a little and slightly
 * overlapping its neighbours.
 */
export function collageLayout(aspects: number[], box: Box, seed = 1): Placement[] {
  const n = aspects.length
  if (!n) return []
  const rand = mulberry32(seed + n * 7919)

  // Pick the column count that leaves the least empty paper.
  let best = { cols: 1, covered: -1 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cellW = box.width / cols
    const cellH = box.height / rows
    let covered = 0
    for (const aspect of aspects) {
      const { width, height } = fitBox(aspect, { x: 0, y: 0, width: cellW, height: cellH })
      covered += width * height
    }
    if (covered > best.covered) best = { cols, covered }
  }

  const cols = best.cols
  const rows = Math.ceil(n / cols)
  const cellW = box.width / cols
  const cellH = box.height / rows
  const tilt = n === 1 ? 0.06 : 0.2
  const overlap = n === 1 ? 1 : 1.12
  return aspects.map((aspect, i) => {
    const row = Math.floor(i / cols)
    const inRow = row === rows - 1 ? n - row * cols : cols
    // An unfinished last row is centred.
    const col = (i % cols) + (cols - inRow) / 2
    const rotation = (rand() * 2 - 1) * tilt
    const { width, height } = fitRotated(aspect, rotation, cellW * overlap, cellH * overlap)
    const jitter = n === 1 ? 0 : 0.06
    // Half the tilted sticker's bounding box, to keep it on the paper.
    const halfW = (width * Math.abs(Math.cos(rotation)) + height * Math.abs(Math.sin(rotation))) / 2
    const halfH = (width * Math.abs(Math.sin(rotation)) + height * Math.abs(Math.cos(rotation))) / 2
    const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
    return {
      cx: clamp(box.x + (col + 0.5) * cellW + (rand() * 2 - 1) * jitter * cellW, box.x + halfW, box.x + box.width - halfW),
      cy: clamp(box.y + (row + 0.5) * cellH + (rand() * 2 - 1) * jitter * cellH, box.y + halfH, box.y + box.height - halfH),
      width,
      height,
      rotation,
    }
  })
}
