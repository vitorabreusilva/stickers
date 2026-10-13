// Coloring books: what a book is, and the choices for its cover. Pure, so it runs in tests.

/** Pages made before there could be more than one book belong to this one. */
export const LEGACY_BOOK_ID = 'default'
export const DEFAULT_TITLE = 'My Coloring Book'

export const COVER_BACKGROUNDS = ['cream', 'pink', 'sky', 'mint', 'lilac', 'sun', 'night'] as const
export type CoverBackground = (typeof COVER_BACKGROUNDS)[number]

export const COVER_LAYOUTS = ['playful', 'tidy', 'wild', 'spotlight'] as const
export type CoverLayout = (typeof COVER_LAYOUTS)[number]

export interface CoverPalette {
  name: string
  /** The paper. */
  paper: string
  /** The dotted pattern on it. */
  dots: string
  /** Title text. */
  ink: string
  /** The small line under the title. */
  accent: string
  /** The outline around the title, like a sticker's white border. */
  outline: string
}

export const COVER_PALETTES: Record<CoverBackground, CoverPalette> = {
  cream: { name: 'Cream', paper: '#fff6ec', dots: 'rgba(122, 77, 255, 0.13)', ink: '#1f1830', accent: '#ff3d7f', outline: '#ffffff' },
  pink: { name: 'Pink', paper: '#ffd6e5', dots: 'rgba(196, 29, 90, 0.14)', ink: '#3a0a24', accent: '#c41d5a', outline: '#ffffff' },
  sky: { name: 'Sky', paper: '#cfe8ff', dots: 'rgba(30, 90, 170, 0.14)', ink: '#0f2440', accent: '#2f6fd6', outline: '#ffffff' },
  mint: { name: 'Mint', paper: '#cdf3e1', dots: 'rgba(20, 120, 80, 0.14)', ink: '#0d2e20', accent: '#138a5a', outline: '#ffffff' },
  lilac: { name: 'Lilac', paper: '#e6dcff', dots: 'rgba(122, 77, 255, 0.16)', ink: '#24124a', accent: '#7a4dff', outline: '#ffffff' },
  sun: { name: 'Sunshine', paper: '#ffe680', dots: 'rgba(170, 100, 0, 0.15)', ink: '#3a2400', accent: '#e0661b', outline: '#ffffff' },
  night: { name: 'Night', paper: '#221a35', dots: 'rgba(255, 255, 255, 0.1)', ink: '#ffffff', accent: '#ffd23f', outline: '#3d2f5c' },
}

export const COVER_LAYOUT_NAMES: Record<CoverLayout, string> = {
  playful: 'Playful',
  tidy: 'Tidy',
  wild: 'Wild',
  spotlight: 'Spotlight',
}

export interface CoverStyle {
  background: CoverBackground
  layout: CoverLayout
}

export const DEFAULT_STYLE: CoverStyle = { background: 'cream', layout: 'playful' }

/**
 * A cover made of one sticker instead of a layout of all of them: the sticker big ('sticker'), or
 * on a postage stamp ('stamp'). With `photo`, the picture the sticker was cut from fills the whole
 * cover instead, behind the title.
 */
export interface BookCover {
  kind: 'sticker' | 'stamp'
  stickerId: string
  photo?: boolean
}

export const COVER_KIND_NAMES: Record<BookCover['kind'], string> = { sticker: 'Single', stamp: 'Stamp' }

/** A synced cover, checked; undefined if it isn't one (or the book uses a layout). */
export function parseBookCover(raw: unknown): BookCover | undefined {
  const r = raw as Partial<BookCover> | null
  if (!r || (r.kind !== 'sticker' && r.kind !== 'stamp') || typeof r.stickerId !== 'string' || !r.stickerId) return undefined
  return { kind: r.kind, stickerId: r.stickerId.slice(0, 64), ...(r.photo === true && { photo: true }) }
}

export function isCoverBackground(value: unknown): value is CoverBackground {
  return typeof value === 'string' && (COVER_BACKGROUNDS as readonly string[]).includes(value)
}

export function isCoverLayout(value: unknown): value is CoverLayout {
  return typeof value === 'string' && (COVER_LAYOUTS as readonly string[]).includes(value)
}

/** A name for a new book that isn't already taken. */
export function newBookTitle(taken: string[]): string {
  const names = new Set(taken.map((t) => t.trim().toLowerCase()))
  if (!names.has(DEFAULT_TITLE.toLowerCase())) return DEFAULT_TITLE
  for (let n = 2; ; n++) {
    const title = `Coloring Book ${n}`
    if (!names.has(title.toLowerCase())) return title
  }
}

/** A file name for the book's PDF. */
export function bookFileName(title: string, suffix = ''): string {
  const name = (title.trim() || DEFAULT_TITLE).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
  return `${name || 'coloring-book'}${suffix}.pdf`
}
