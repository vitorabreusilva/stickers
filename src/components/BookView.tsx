import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { bookSides, type BookSide } from '../lib/book-layout'
import { bookToPdf, printBook } from '../lib/book-render'
import {
  bookFileName,
  COVER_BACKGROUNDS,
  COVER_LAYOUT_NAMES,
  COVER_LAYOUTS,
  COVER_PALETTES,
  DEFAULT_TITLE,
  LEGACY_BOOK_ID,
} from '../lib/books'
import type { BookRecord } from '../lib/db'
import { storeBookTitle } from '../lib/book-title'
import { downloadBlob } from '../lib/device'
import { bookContents, useBookPreviews } from '../hooks/useBookPreviews'
import type { Book } from '../hooks/useColoringBooks'
import { pageCount } from './BookCard'
import { BackIcon, BookIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, ExpandIcon, PrintIcon, TrashIcon } from './icons'

interface Props {
  book: Book
  onUpdate: (patch: Partial<Omit<BookRecord, 'id'>>) => Promise<void>
  onDelete: () => Promise<void>
  onRemovePage: (id: string) => Promise<void>
  onMovePage: (id: string, by: number) => Promise<void>
  /** Opens the page-through preview at side `index`. */
  onPreview: (index: number) => void
  onClose: () => void
  toast: (message: string) => void
}

export function sideLabel(side: BookSide): string {
  switch (side.kind) {
    case 'cover':
      return 'Cover'
    case 'inside-cover':
      return 'Inside cover'
    case 'page':
      return `Page ${side.folio}`
    case 'blank':
      return `Page ${side.folio}, blank`
    case 'inside-back':
      return 'Inside back cover'
    case 'back':
      return 'Back cover'
  }
}

/** A coloring book: its title and cover, every page as it will print, and printing. */
export function BookView({ book, onUpdate, onDelete, onRemovePage, onMovePage, onPreview, onClose, toast }: Props) {
  const [title, setTitle] = useState(book.title)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [busy, setBusy] = useState<'print' | 'pages' | 'booklet' | null>(null)
  const contents = useMemo(() => bookContents(book), [book])
  const sides = useMemo(() => bookSides(book.pages.length), [book.pages.length])
  const previews = useBookPreviews(contents, sides)
  const blanks = sides.filter((s) => s.kind === 'blank').length
  const hasPages = book.pages.length > 0

  // Save the title once typing pauses (every page's running head is redrawn for it), or on leaving.
  const pendingTitle = useRef<string | null>(null)
  const saveTitle = useRef(() => {})
  saveTitle.current = () => {
    const value = pendingTitle.current
    if (value === null) return
    pendingTitle.current = null
    onUpdate({ title: value }).catch(() => toast("Couldn't save the title"))
    // Devices that haven't updated still read the first book's title from here.
    if (book.id === LEGACY_BOOK_ID) storeBookTitle(value)
  }
  useEffect(() => {
    if (title === book.title && pendingTitle.current === null) return
    pendingTitle.current = title
    const timer = setTimeout(() => saveTitle.current(), 400)
    return () => clearTimeout(timer)
    // Only typing starts a save; the book changing under it (a cover change, say) doesn't.
  }, [title])
  useEffect(() => () => saveTitle.current(), [])

  const removePage = async (id: string, label: string) => {
    if (confirming !== id) {
      setConfirming(id)
      return
    }
    setConfirming(null)
    try {
      await onRemovePage(id)
    } catch {
      toast(`Couldn't remove ${label.toLowerCase()}`)
    }
  }

  const deleteBook = async () => {
    if (confirming !== 'book') {
      setConfirming('book')
      return
    }
    try {
      await onDelete()
    } catch {
      toast("Couldn't delete the book")
    }
  }

  const exportBook = async (how: 'print' | 'pages' | 'booklet') => {
    if (busy) return
    setBusy(how)
    try {
      const latest = { ...contents, title: title.trim() || DEFAULT_TITLE }
      if (how === 'print') await printBook(latest)
      else downloadBlob(await bookToPdf(latest, how), bookFileName(latest.title, how === 'booklet' ? '-booklet' : ''))
      setExportOpen(false)
    } catch (err) {
      console.error(err)
      toast(how === 'print' ? "Couldn't open printing" : "Couldn't make the PDF")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="book-screen" role="dialog" aria-modal="true" aria-label="Coloring book">
      <div className="book-screen-inner">
        <header className="book-bar">
          <button className="icon-btn book-bar-btn" onClick={onClose} aria-label="Back">
            <BackIcon />
          </button>
          <h2>
            Coloring book <span className="beta">Beta</span>
          </h2>
          <button
            className={`book-delete${confirming === 'book' ? ' confirming' : ''}`}
            onClick={deleteBook}
            onBlur={() => confirming === 'book' && setConfirming(null)}
            aria-label={confirming === 'book' ? 'Really delete this book?' : 'Delete book'}
          >
            {confirming === 'book' ? 'Delete?' : <TrashIcon />}
          </button>
        </header>

        <label className="book-title">
          <span>Title</span>
          <input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder={DEFAULT_TITLE} />
        </label>

        <section className="cover-options" aria-label="Cover">
          <div className="cover-option">
            <span className="cover-option-label">Cover</span>
            <div className="swatches cover-swatches" role="radiogroup" aria-label="Cover colour">
              {COVER_BACKGROUNDS.map((bg) => (
                <button
                  key={bg}
                  role="radio"
                  aria-checked={book.background === bg}
                  aria-label={COVER_PALETTES[bg].name}
                  className="swatch"
                  style={{ '--folder': COVER_PALETTES[bg].paper } as CSSProperties}
                  onClick={() => onUpdate({ background: bg }).catch(() => toast("Couldn't change the cover"))}
                />
              ))}
            </div>
          </div>
          <div className="segmented cover-layouts" role="radiogroup" aria-label="Sticker layout">
            {COVER_LAYOUTS.map((layout) => (
              <button
                key={layout}
                role="radio"
                aria-checked={book.layout === layout}
                className={book.layout === layout ? 'active' : ''}
                onClick={() => onUpdate({ layout }).catch(() => toast("Couldn't change the cover"))}
              >
                <LayoutGlyph layout={layout} />
                {COVER_LAYOUT_NAMES[layout]}
              </button>
            ))}
          </div>
        </section>

        <div className="book-summary">
          <p>
            {hasPages ? (
              <>
                <strong>{pageCount(sides.length)} to print</strong>, covers included
                {blanks > 0 && ` · ${blanks} blank ${blanks === 1 ? 'page' : 'pages'} to draw on, so it folds into a booklet`}
              </>
            ) : (
              'No pages yet. Open a sticker and tap Color to turn it into a coloring page, then add it here.'
            )}
          </p>
          <button className="btn btn-ghost book-preview-btn" onClick={() => onPreview(0)}>
            <ExpandIcon /> Page through
          </button>
        </div>

        <ol className="book-pages" aria-label="Pages">
          {sides.map((side, i) => {
            const label = sideLabel(side)
            const page = side.kind === 'page' ? book.pages[side.index] : null
            return (
              <li key={page ? page.id : `${side.kind}-${i}`} className={`book-page book-page-${side.kind}`}>
                <button className="paper paper-small book-page-open" onClick={() => onPreview(i)} aria-label={`Preview ${label.toLowerCase()}`}>
                  {previews[i] ? (
                    <img src={previews[i]!} alt={label} data-testid={side.kind === 'cover' ? 'book-cover' : undefined} />
                  ) : (
                    <div className="spinner" />
                  )}
                </button>
                {page && side.kind === 'page' ? (
                  <>
                    <div className="book-page-tools">
                      <button
                        className="icon-btn"
                        onClick={() => onMovePage(page.id, -1)}
                        disabled={side.index === 0}
                        aria-label={`Move page ${side.folio} earlier`}
                      >
                        <ChevronLeftIcon />
                      </button>
                      <span className="book-page-label">{side.folio}</span>
                      <button
                        className="icon-btn"
                        onClick={() => onMovePage(page.id, 1)}
                        disabled={side.index === book.pages.length - 1}
                        aria-label={`Move page ${side.folio} later`}
                      >
                        <ChevronRightIcon />
                      </button>
                    </div>
                    <button
                      className={`book-page-remove${confirming === page.id ? ' confirming' : ''}`}
                      onClick={() => removePage(page.id, label)}
                      onBlur={() => confirming === page.id && setConfirming(null)}
                      aria-label={confirming === page.id ? `Really remove page ${side.folio}?` : `Remove page ${side.folio}`}
                    >
                      {confirming === page.id ? 'Remove?' : <CloseIcon />}
                    </button>
                  </>
                ) : (
                  <span className="book-page-label">{side.kind === 'blank' ? `${side.folio} · Blank` : label}</span>
                )}
              </li>
            )
          })}
        </ol>

        <div className="book-actions book-actions-docked">
          <button className="btn btn-secondary" onClick={() => onPreview(0)}>
            <BookIcon /> Preview
          </button>
          <button className="btn btn-primary" onClick={() => setExportOpen(true)} disabled={!hasPages}>
            <PrintIcon /> Print or save
          </button>
        </div>
      </div>

      {exportOpen && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && setExportOpen(false)}>
          <div className="sheet export-sheet" role="dialog" aria-modal="true" aria-label="Print or save">
            <header className="sheet-header">
              <span className="icon-btn-spacer" />
              <h2>Print or save</h2>
              <button className="icon-btn" onClick={() => setExportOpen(false)} aria-label="Close" disabled={!!busy}>
                <CloseIcon />
              </button>
            </header>
            <p className="export-intro">
              {pageCount(sides.length)} of A5 (148 × 210 mm), with the covers. That's {sides.length / 4}{' '}
              {sides.length === 4 ? 'sheet' : 'sheets'} of A4 folded in half.
            </p>
            <button className="export-option" onClick={() => exportBook('booklet')} disabled={!!busy}>
              <BookIcon />
              <span>
                <strong>{busy === 'booklet' ? 'Making the booklet…' : 'Booklet PDF'}</strong>
                <small>Two pages on each A4 sheet. Print double-sided, flipping on the short edge, then fold the stack in half.</small>
              </span>
            </button>
            <button className="export-option" onClick={() => exportBook('pages')} disabled={!!busy}>
              <DownloadIcon />
              <span>
                <strong>{busy === 'pages' ? 'Making the PDF…' : 'Save PDF'}</strong>
                <small>One A5 page at a time, in reading order. Good for print shops.</small>
              </span>
            </button>
            <button className="export-option" onClick={() => exportBook('print')} disabled={!!busy}>
              <PrintIcon />
              <span>
                <strong>{busy === 'print' ? 'Getting the pages ready…' : 'Print'}</strong>
                <small>Every page in order on A5 paper, from this device.</small>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** A tiny sketch of each cover layout, for its button. */
function LayoutGlyph({ layout }: { layout: BookRecord['layout'] }) {
  const boxes: Record<BookRecord['layout'], [number, number, number, number, number][]> = {
    playful: [
      [2, 3, 7, 7, -8],
      [11, 2, 7, 7, 6],
      [3, 11, 7, 7, 5],
      [11, 11, 7, 7, -6],
    ],
    tidy: [
      [2.5, 2.5, 6, 6, 0],
      [11.5, 2.5, 6, 6, 0],
      [2.5, 11.5, 6, 6, 0],
      [11.5, 11.5, 6, 6, 0],
    ],
    wild: [
      [1, 4, 10, 10, -24],
      [8, 1, 9, 9, 18],
      [7, 9, 10, 10, -10],
    ],
    spotlight: [
      [4, 1, 12, 11, -3],
      [2, 14, 4.5, 4.5, 0],
      [7.75, 14, 4.5, 4.5, 0],
      [13.5, 14, 4.5, 4.5, 0],
    ],
  }
  return (
    <svg className="layout-glyph" viewBox="0 0 20 20" aria-hidden="true">
      {boxes[layout].map(([x, y, w, h, r], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="1.6" transform={`rotate(${r} ${x + w / 2} ${y + h / 2})`} />
      ))}
    </svg>
  )
}
