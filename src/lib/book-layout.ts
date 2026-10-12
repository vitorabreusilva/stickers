// Page geometry for the coloring book: A5 pages at print resolution, and the sticker collage on the
// cover. Pure math, so it runs in tests.

import type { CoverLayout } from './books'

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

/** Where the drawing goes on a coloring page, leaving margins and a footer for the colour guide. */
export const ART_BOX: Box = {
  x: mmToPx(MARGIN_MM),
  y: mmToPx(MARGIN_MM),
  width: PAGE_PX.width - 2 * mmToPx(MARGIN_MM),
  height: PAGE_PX.height - 2 * mmToPx(MARGIN_MM) - mmToPx(FOOTER_MM),
}

/** The footer strip under the drawing, where the colour guide sits on the right. */
export const FOOTER_BOX: Box = {
  x: ART_BOX.x,
  y: ART_BOX.y + ART_BOX.height + mmToPx(4),
  width: ART_BOX.width,
  height: mmToPx(FOOTER_MM - 4),
}

/** The colour guide's spot: the right end of the footer. */
export const GUIDE_BOX: Box = {
  x: FOOTER_BOX.x + FOOTER_BOX.width - mmToPx(26),
  y: FOOTER_BOX.y,
  width: mmToPx(26),
  height: FOOTER_BOX.height,
}

/**
 * Where pages made before the new layout have their "Colored by" line: the words and a rule along
 * this baseline, from the left of the footer up to the colour guide, or to the end without one.
 */
export const LEGACY_BASELINE = FOOTER_BOX.y + FOOTER_BOX.height - mmToPx(3)

/**
 * Whether an old page has a colour guide, from the pixels of its GUIDE_BOX (RGBA, row by row).
 * Without one, the only ink there is the rule along the baseline; a guide fills the box.
 */
export function hasLegacyGuide(rgba: ArrayLike<number>, width: number, height: number): boolean {
  const ruleRow = LEGACY_BASELINE - GUIDE_BOX.y
  const band = mmToPx(0.8)
  let inked = 0
  for (let y = 0; y < height; y++) {
    if (Math.abs(y - ruleRow) <= band) continue
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (rgba[i + 3] > 0 && Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < 235) inked++
    }
  }
  return inked > width * height * 0.002
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

  const cols = bestColumns(aspects, box)
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
    return keepInside(
      {
        cx: box.x + (col + 0.5) * cellW + (rand() * 2 - 1) * jitter * cellW,
        cy: box.y + (row + 0.5) * cellH + (rand() * 2 - 1) * jitter * cellH,
        width,
        height,
        rotation,
      },
      box,
    )
  })
}

/** Fits `aspect` stickers into a grid over `box`, choosing the column count that leaves the least empty paper. */
function bestColumns(aspects: number[], box: Box) {
  let best = { cols: 1, covered: -1 }
  for (let cols = 1; cols <= aspects.length; cols++) {
    const rows = Math.ceil(aspects.length / cols)
    const cellW = box.width / cols
    const cellH = box.height / rows
    let covered = 0
    for (const aspect of aspects) {
      const { width, height } = fitBox(aspect, { x: 0, y: 0, width: cellW, height: cellH })
      covered += width * height
    }
    if (covered > best.covered) best = { cols, covered }
  }
  return best.cols
}

/** Half the bounding box of a tilted sticker. */
function halfExtent(p: Pick<Placement, 'width' | 'height' | 'rotation'>) {
  const cos = Math.abs(Math.cos(p.rotation))
  const sin = Math.abs(Math.sin(p.rotation))
  return { halfW: (p.width * cos + p.height * sin) / 2, halfH: (p.width * sin + p.height * cos) / 2 }
}

const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))

/** Keeps a placement's tilted bounding box inside `box`. */
function keepInside(p: Placement, box: Box): Placement {
  const { halfW, halfH } = halfExtent(p)
  return {
    ...p,
    cx: clamp(p.cx, box.x + halfW, box.x + box.width - halfW),
    cy: clamp(p.cy, box.y + halfH, box.y + box.height - halfH),
  }
}

/** Neat rows and columns, upright, with a little air between stickers. */
export function tidyLayout(aspects: number[], box: Box): Placement[] {
  const n = aspects.length
  if (!n) return []
  const cols = bestColumns(aspects, box)
  const rows = Math.ceil(n / cols)
  const cellW = box.width / cols
  const cellH = box.height / rows
  const pad = n === 1 ? 0 : 0.1
  return aspects.map((aspect, i) => {
    const row = Math.floor(i / cols)
    const inRow = row === rows - 1 ? n - row * cols : cols
    const col = (i % cols) + (cols - inRow) / 2
    const { width, height } = fitBox(aspect, { x: 0, y: 0, width: cellW * (1 - pad), height: cellH * (1 - pad) })
    return { cx: box.x + (col + 0.5) * cellW, cy: box.y + (row + 0.5) * cellH, width, height, rotation: 0 }
  })
}

/** Thrown on in a heap: big, steeply tilted, piled over each other. */
export function wildLayout(aspects: number[], box: Box, seed = 1): Placement[] {
  const n = aspects.length
  if (!n) return []
  const rand = mulberry32(seed * 31 + n * 104729)
  const cols = bestColumns(aspects, box)
  const rows = Math.ceil(n / cols)
  const cellW = box.width / cols
  const cellH = box.height / rows
  const grow = n === 1 ? 0.9 : 1.45
  return aspects.map((aspect, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const rotation = (rand() * 2 - 1) * (n === 1 ? 0.15 : 0.55)
    const { width, height } = fitRotated(aspect, rotation, Math.min(box.width, cellW * grow), Math.min(box.height, cellH * grow))
    const jitter = n === 1 ? 0 : 0.3
    return keepInside(
      {
        cx: box.x + (col + 0.5 + (rand() * 2 - 1) * jitter) * cellW,
        cy: box.y + (row + 0.5 + (rand() * 2 - 1) * jitter) * cellH,
        width,
        height,
        rotation,
      },
      box,
    )
  })
}

/** The first sticker large in the middle, the rest in a neat strip along the bottom. */
export function spotlightLayout(aspects: number[], box: Box): Placement[] {
  const n = aspects.length
  if (!n) return []
  if (n === 1) return tidyLayout(aspects, box)
  const stripHeight = box.height * (n <= 4 ? 0.26 : 0.32)
  const gap = box.height * 0.04
  const hero = { ...box, height: box.height - stripHeight - gap }
  const strip = { x: box.x, y: box.y + hero.height + gap, width: box.width, height: stripHeight }
  const { width, height } = fitBox(aspects[0], { x: 0, y: 0, width: hero.width * 0.92, height: hero.height * 0.92 })
  return [
    keepInside({ cx: hero.x + hero.width / 2, cy: hero.y + hero.height / 2, width, height, rotation: -0.04 }, box),
    ...tidyLayout(aspects.slice(1), strip),
  ]
}

/** Where the stickers go on a cover in each of the cover layouts. */
export function coverLayout(layout: CoverLayout, aspects: number[], box: Box): Placement[] {
  switch (layout) {
    case 'tidy':
      return tidyLayout(aspects, box)
    case 'wild':
      return wildLayout(aspects, box)
    case 'spotlight':
      return spotlightLayout(aspects, box)
    default:
      return collageLayout(aspects, box)
  }
}

/** One side of a sheet in the printed book. */
export type BookSide =
  | { kind: 'cover' }
  /** The inside of the front cover: "This book belongs to". */
  | { kind: 'inside-cover' }
  /** A coloring page; `index` is its place among the book's pages. */
  | { kind: 'page'; index: number; folio: number }
  /** A spare page that rounds the book up to whole sheets, left for drawing. */
  | { kind: 'blank'; folio: number }
  | { kind: 'inside-back' }
  | { kind: 'back' }

/**
 * Every side of the printed book in reading order. A folded booklet is made of sheets of four
 * sides, so the pages are rounded up to a multiple of four with blank ones. With the four sides of
 * the cover, the whole book is then a multiple of four too.
 */
export function bookSides(pageCount: number): BookSide[] {
  const inside = Math.ceil(pageCount / 4) * 4
  const sides: BookSide[] = [{ kind: 'cover' }, { kind: 'inside-cover' }]
  for (let i = 0; i < inside; i++) {
    sides.push(i < pageCount ? { kind: 'page', index: i, folio: i + 1 } : { kind: 'blank', folio: i + 1 })
  }
  sides.push({ kind: 'inside-back' }, { kind: 'back' })
  return sides
}

/** Whether side `i` (from 0, in reading order) is a right-hand page. The cover is. */
export const isRecto = (i: number) => i % 2 === 0

/**
 * The book as it looks when leafed through: the cover alone on the right, then facing pairs, then
 * the back cover alone on the left. Each spread lists side indices, left to right.
 */
export function bookSpreads(sideCount: number): number[][] {
  if (sideCount <= 0) return []
  if (sideCount === 1) return [[0]]
  const spreads: number[][] = [[0]]
  for (let i = 1; i < sideCount - 1; i += 2) spreads.push(i + 1 < sideCount - 1 ? [i, i + 1] : [i])
  spreads.push([sideCount - 1])
  return spreads
}

/**
 * Imposition for a saddle-stitched booklet: which two sides go on each printed sheet face, left
 * then right, so that printing double-sided (flipping on the short edge), stacking the sheets and
 * folding them in half gives the pages in order. `sideCount` must be a multiple of four.
 */
export function bookletSheets(sideCount: number): [number, number][] {
  if (sideCount % 4) throw new Error('A booklet needs a multiple of four pages')
  const faces: [number, number][] = []
  for (let s = 0; s < sideCount / 4; s++) {
    faces.push([sideCount - 1 - 2 * s, 2 * s], [2 * s + 1, sideCount - 2 - 2 * s])
  }
  return faces
}
