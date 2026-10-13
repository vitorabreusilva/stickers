import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { bookSides, bookSpreads, type BookSide } from '../lib/book-layout'
import { bookContents, useBookPreviews } from '../hooks/useBookPreviews'
import type { Book } from '../hooks/useColoringBooks'
import type { BookRecord } from '../lib/db'
import { sideLabel } from './BookView'
import { CoverEditor } from './CoverEditor'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, PaletteIcon } from './icons'

interface Props {
  book: Book
  /** The side to open at. */
  start: number
  /** Opens at the cover with its options showing. */
  customize?: boolean
  /** Whether the picture a sticker was made from is here, or can be fetched. */
  hasPhoto: (stickerId: string) => boolean
  onUpdate: (patch: Partial<Omit<BookRecord, 'id'>>) => Promise<void>
  onClose: () => void
  toast: (message: string) => void
}

const WIDE = '(min-aspect-ratio: 1/1) and (min-width: 560px)'

function useMatchMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const change = () => setMatches(list.matches)
    list.addEventListener('change', change)
    return () => list.removeEventListener('change', change)
  }, [query])
  return matches
}

function spreadLabel(sides: BookSide[], spread: number[]) {
  if (spread.length === 1) return sideLabel(sides[spread[0]])
  const folio = (s: BookSide) => (s.kind === 'page' || s.kind === 'blank' ? s.folio : null)
  const [left, right] = spread.map((i) => folio(sides[i]))
  if (left !== null && right !== null) return `Pages ${left}–${right}`
  return spread.map((i) => sideLabel(sides[i])).join(' · ')
}

/** Leafs through a book as it will print: facing pages on wide screens, one at a time on narrow ones. */
export function BookPreview({ book, start, customize = false, hasPhoto, onUpdate, onClose, toast }: Props) {
  const contents = useMemo(() => bookContents(book), [book])
  const sides = useMemo(() => bookSides(book.pages.length), [book.pages.length])
  const spreads = useMemo(() => bookSpreads(sides.length), [sides.length])
  const previews = useBookPreviews(contents, sides)
  const wide = useMatchMedia(WIDE)
  const [choice, setChoice] = useState<'spreads' | 'single' | null>(null)
  // Customizing shows the cover on its own, with its options under it.
  const [editing, setEditing] = useState(customize)
  const mode = editing ? 'single' : (choice ?? (wide ? 'spreads' : 'single'))
  // Where we are, as a side, so switching between spreads and single pages keeps the place.
  const [side, setSide] = useState(() => (customize ? 0 : Math.min(Math.max(0, start), sides.length - 1)))
  const [direction, setDirection] = useState<1 | -1>(1)

  const at = Math.min(side, sides.length - 1)
  const spreadIndex = spreads.findIndex((s) => s.includes(at))
  const shown = mode === 'spreads' ? spreads[spreadIndex] : [at]
  const position = mode === 'spreads' ? spreadIndex : at
  const total = mode === 'spreads' ? spreads.length : sides.length

  const go = (by: 1 | -1) => {
    if (editing) return
    const next = position + by
    if (next < 0 || next >= total) return
    setDirection(by)
    setSide(mode === 'spreads' ? spreads[next][0] : next)
  }
  const goRef = useRef(go)
  goRef.current = go

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goRef.current(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goRef.current(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Swiping turns the page.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: PointerEvent) => {
    const from = swipe.current
    swipe.current = null
    if (!from) return
    const dx = e.clientX - from.x
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - from.y)) go(dx < 0 ? 1 : -1)
  }

  // A cover on its own sits where it would in the book: the front on the right, the back on the left.
  const lone = mode === 'spreads' && shown.length === 1 ? (shown[0] === 0 ? 'right' : 'left') : null

  return (
    <div className={`viewer${editing ? ' viewer-editing' : ''}`} role="dialog" aria-modal="true" aria-label="Book preview">
      <header className="viewer-bar">
        <button className="icon-btn viewer-btn" onClick={onClose} aria-label="Close preview">
          <CloseIcon />
        </button>
        <p className="viewer-title" aria-live="polite">
          {spreadLabel(sides, shown)}
        </p>
        {editing ? (
          <span className="icon-btn-spacer" />
        ) : (
          <div className="segmented viewer-mode" role="radiogroup" aria-label="View">
            <button role="radio" aria-checked={mode === 'spreads'} className={mode === 'spreads' ? 'active' : ''} onClick={() => setChoice('spreads')}>
              Spreads
            </button>
            <button role="radio" aria-checked={mode === 'single'} className={mode === 'single' ? 'active' : ''} onClick={() => setChoice('single')}>
              Pages
            </button>
          </div>
        )}
      </header>

      <div className="viewer-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipe.current = null)}>
        <div
          key={`${mode}-${position}`}
          className={`viewer-spread viewer-${mode}${lone ? ` viewer-lone-${lone}` : ''}`}
          data-direction={direction}
        >
          {lone === 'right' && <span className="viewer-page viewer-page-empty" />}
          {shown.map((i, n) => (
            <div
              key={i}
              className={`viewer-page${mode === 'spreads' && !lone ? (n === 0 ? ' viewer-page-left' : ' viewer-page-right') : ''}`}
            >
              {previews[i] ? <img src={previews[i]!} alt={sideLabel(sides[i])} draggable={false} /> : <span className="spinner" />}
            </div>
          ))}
          {lone === 'left' && <span className="viewer-page viewer-page-empty" />}
        </div>
      </div>

      {editing ? (
        <CoverEditor book={book} hasPhoto={hasPhoto} onUpdate={onUpdate} onDone={() => setEditing(false)} toast={toast} />
      ) : (
        <footer className="viewer-foot">
          {shown.includes(0) && (
            <button
              className="btn btn-ghost-dark viewer-customize"
              onClick={() => {
                setSide(0)
                setEditing(true)
              }}
            >
              <PaletteIcon /> Customize cover
            </button>
          )}
          <div className="viewer-nav">
            <button className="icon-btn viewer-btn" onClick={() => go(-1)} disabled={position === 0} aria-label="Previous">
              <ChevronLeftIcon />
            </button>
            <span className="viewer-count">
              {position + 1} / {total}
            </span>
            <button className="icon-btn viewer-btn" onClick={() => go(1)} disabled={position === total - 1} aria-label="Next">
              <ChevronRightIcon />
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}
