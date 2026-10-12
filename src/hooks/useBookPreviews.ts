import { useEffect, useMemo, useRef, useState } from 'react'
import type { BookSide } from '../lib/book-layout'
import { renderSide, type BookContents, type CoverSticker } from '../lib/book-render'
import { canvasToBlob } from '../lib/image'
import type { Book } from './useColoringBooks'

/** Previews are drawn at 40% of print size: sharp on a phone, and quick to make. */
const PREVIEW_SCALE = 0.4
const MAX_CACHED = 300

// Drawn sides by what's on them, shared by every screen, so the home screen's covers and the book
// screen's pages are only drawn once. Drawing goes one side at a time to keep the page responsive,
// and skips sides no screen wants any more (an old title, say) by the time their turn comes.
const cache = new Map<string, Promise<string | null>>()
const wanted = new Map<string, number>()
let queue: Promise<unknown> = Promise.resolve()

function preview(key: string, draw: () => Promise<HTMLCanvasElement>): Promise<string | null> {
  const known = cache.get(key)
  if (known) return known
  const job = queue.then(async () => {
    if (!wanted.has(key)) {
      cache.delete(key)
      return null
    }
    const canvas = await draw()
    return URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg'))
  })
  queue = job.catch((err) => {
    console.error('Could not draw a page preview', err)
    cache.delete(key)
  })
  cache.set(key, job)
  for (const [old, url] of cache) {
    if (cache.size <= MAX_CACHED) break
    if (wanted.has(old)) continue
    cache.delete(old)
    url.then((u) => u && URL.revokeObjectURL(u)).catch(() => {})
  }
  return job
}

/** Everything the book's sides are drawn from. */
export function bookContents(book: Book): BookContents {
  const seen = new Set<string>()
  const stickers: CoverSticker[] = []
  for (const page of book.pages) {
    if (seen.has(page.stickerId)) continue
    seen.add(page.stickerId)
    stickers.push({ key: `${page.stickerId}:${page.effect ?? ''}`, blob: page.sticker, effect: page.effect })
  }
  return {
    title: book.title,
    style: { background: book.background, layout: book.layout },
    pages: book.pages.map(({ id, page, hideGuide }) => ({ id, page, hideGuide })),
    stickers,
  }
}

/** What a side shows, as a string: two sides with the same key look the same. */
function sideKey(side: BookSide, book: BookContents): string {
  switch (side.kind) {
    case 'cover':
      return `cover|${book.title}|${book.style.background}|${book.style.layout}|${book.stickers.map((s) => s.key).join(',')}`
    case 'page':
      {
      const { id, hideGuide } = book.pages[side.index]
      return `page|${id}|${hideGuide ? 'no-guide' : ''}|${side.folio}|${book.title}`
    }
    case 'blank':
      return `blank|${side.folio}|${book.title}`
    case 'back':
      return `back|${book.style.background}|${book.title}`
    default:
      return side.kind
  }
}

/** Preview pictures of `sides` of a book, as object URLs; null until each is drawn. */
export function useBookPreviews(book: BookContents | null, sides: BookSide[]): (string | null)[] {
  const keys = useMemo(() => (book ? sides.map((side) => sideKey(side, book)) : []), [book, sides])
  const signature = keys.join('\n')
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!book) return
    let live = true
    keys.forEach((key) => wanted.set(key, (wanted.get(key) ?? 0) + 1))
    keys.forEach((key, i) => {
      preview(key, () => renderSide(sides[i], book, PREVIEW_SCALE))
        .then((url) => {
          if (live && url) setUrls((current) => (current[key] === url ? current : { ...current, [key]: url }))
        })
        .catch(() => {})
    })
    return () => {
      live = false
      keys.forEach((key) => {
        const n = (wanted.get(key) ?? 1) - 1
        if (n > 0) wanted.set(key, n)
        else wanted.delete(key)
      })
    }
    // The keys say everything about what's drawn; `book` and `sides` are new objects every render.
  }, [signature])

  // While a side is redrawn (after a title change, say), the old picture stays up.
  const shown = useRef<(string | null)[]>([])
  shown.current = keys.map((key, i) => urls[key] ?? shown.current[i] ?? null)
  return shown.current
}
