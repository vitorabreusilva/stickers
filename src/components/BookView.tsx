import { useEffect, useMemo, useRef, useState } from 'react'
import { useDragReorder } from '../hooks/useDragReorder'
import { bookSides, type BookSide } from '../lib/book-layout'
import { bookToPdf, printBook } from '../lib/book-render'
import { bookFileName, DEFAULT_TITLE, LEGACY_BOOK_ID } from '../lib/books'
import type { BookPageRecord, BookRecord } from '../lib/db'
import { storeBookTitle } from '../lib/book-title'
import { downloadBlob } from '../lib/device'
import { bookContents, useBookPreviews } from '../hooks/useBookPreviews'
import type { Book, BookPage } from '../hooks/useColoringBooks'
import { pageCount } from './BookCard'
import {
  BackIcon,
  BookIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  ExpandIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  PrintIcon,
  SparkleIcon,
  TrashIcon,
} from './icons'

interface Props {
  book: Book
  onUpdate: (patch: Partial<Omit<BookRecord, 'id'>>) => Promise<void>
  onDelete: () => Promise<void>
  /** Every book, so a page can move to another one. */
  books: Book[]
  onCreateBook: () => Promise<BookRecord>
  onRemovePage: (id: string) => Promise<void>
  /** Puts the book's pages in the order of `ids`. */
  onReorderPages: (ids: string[]) => Promise<void>
  onUpdatePage: (id: string, patch: Partial<Pick<BookPageRecord, 'bookId' | 'hideGuide'>>) => Promise<void>
  /** Opens the page-through preview at side `index`, or at the cover to customize it. */
  onPreview: (index: number, customize?: boolean) => void
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
export function BookView({
  book,
  books,
  onCreateBook,
  onUpdate,
  onDelete,
  onRemovePage,
  onReorderPages,
  onUpdatePage,
  onPreview,
  onClose,
  toast,
}: Props) {
  const [title, setTitle] = useState(book.title)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [busy, setBusy] = useState<'print' | 'pages' | 'booklet' | null>(null)
  const contents = useMemo(() => bookContents(book), [book])
  const sides = useMemo(() => bookSides(book.pages.length), [book.pages.length])
  const previews = useBookPreviews(contents, sides)
  const blanks = sides.filter((s) => s.kind === 'blank').length
  const hasPages = book.pages.length > 0
  const [editing, setEditing] = useState<string | null>(null)
  const editingPage = book.pages.find((p) => p.id === editing)

  const reorder = (ids: string[]) => onReorderPages(ids).catch(() => toast("Couldn't move the page"))
  const movePage = (id: string, by: number) => {
    const ids = book.pages.map((p) => p.id)
    const from = ids.indexOf(id)
    const to = from + by
    if (from < 0 || to < 0 || to >= ids.length) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    reorder(ids)
  }
  const screenRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const drag = useDragReorder(
    useMemo(() => book.pages.map((p) => p.id), [book.pages]),
    reorder,
    listRef,
    screenRef,
  )
  // While dragging, pages show in the new order with the pictures they already have.
  const pagesById = useMemo(() => new Map(book.pages.map((p) => [p.id, p])), [book.pages])
  const previewByPage = new Map<string, string | null>()
  sides.forEach((side, i) => side.kind === 'page' && previewByPage.set(book.pages[side.index].id, previews[i]))

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
    <div className="book-screen" ref={screenRef} role="dialog" aria-modal="true" aria-label="Coloring book">
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

        <button className="btn btn-secondary book-cover-btn" onClick={() => onPreview(0, true)}>
          <PaletteIcon /> Customize cover
        </button>

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

        <ol className={`book-pages${drag.dragging ? ' sorting' : ''}`} aria-label="Pages" ref={listRef}>
          {sides.map((side, i) => {
            const label = sideLabel(side)
            const page = side.kind === 'page' ? pagesById.get(drag.order[side.index]) : undefined
            if (page && side.kind === 'page') {
              const preview = previewByPage.get(page.id)
              return (
                <li
                  key={page.id}
                  data-drag-id={page.id}
                  className={`book-page book-page-page${drag.dragging === page.id ? ' drag-placeholder' : ''}`}
                >
                  <button
                    className="paper paper-small book-page-open"
                    onClick={() => onPreview(sides.findIndex((s) => s.kind === 'page' && book.pages[s.index].id === page.id))}
                    aria-label={`Preview ${label.toLowerCase()}`}
                    aria-describedby="book-drag-hint"
                    {...drag.handle(page.id)}
                  >
                    {preview ? <img src={preview} alt={label} draggable={false} /> : <div className="spinner" />}
                  </button>
                  <div className="book-page-tools">
                    <button
                      className="icon-btn"
                      onClick={() => movePage(page.id, -1)}
                      disabled={side.index === 0}
                      aria-label={`Move page ${side.folio} earlier`}
                    >
                      <ChevronLeftIcon />
                    </button>
                    <span className="book-page-label">{side.folio}</span>
                    <button
                      className="icon-btn"
                      onClick={() => movePage(page.id, 1)}
                      disabled={side.index === book.pages.length - 1}
                      aria-label={`Move page ${side.folio} later`}
                    >
                      <ChevronRightIcon />
                    </button>
                  </div>
                  <button className="book-page-edit" onClick={() => setEditing(page.id)} aria-label={`Edit page ${side.folio}`}>
                    <PencilIcon />
                  </button>
                  <button
                    className={`book-page-remove${confirming === page.id ? ' confirming' : ''}`}
                    onClick={() => removePage(page.id, label)}
                    onBlur={() => confirming === page.id && setConfirming(null)}
                    aria-label={confirming === page.id ? `Really remove page ${side.folio}?` : `Remove page ${side.folio}`}
                  >
                    {confirming === page.id ? 'Remove?' : <CloseIcon />}
                  </button>
                </li>
              )
            }
            return (
              <li key={`${side.kind}-${i}`} className={`book-page book-page-${side.kind}`}>
                <button className="paper paper-small book-page-open" onClick={() => onPreview(i)} aria-label={`Preview ${label.toLowerCase()}`}>
                  {previews[i] ? (
                    <img src={previews[i]!} alt={label} draggable={false} data-testid={side.kind === 'cover' ? 'book-cover' : undefined} />
                  ) : (
                    <div className="spinner" />
                  )}
                </button>
                <span className="book-page-label">{side.kind === 'blank' ? `${side.folio} · Blank` : label}</span>
              </li>
            )
          })}
        </ol>
        {book.pages.length > 1 && (
          <p className="book-drag-hint" id="book-drag-hint">
            Drag a page to move it. On a touch screen, press and hold it first.
          </p>
        )}

        {drag.ghost && (
          <div className="book-drag-ghost" ref={drag.ghostRef} style={{ width: drag.ghost.width }} aria-hidden="true">
            <div className="paper paper-small">
              {previewByPage.get(drag.ghost.id) ? <img src={previewByPage.get(drag.ghost.id)!} alt="" /> : <div className="spinner" />}
            </div>
          </div>
        )}

        <div className="book-actions book-actions-docked">
          <button className="btn btn-secondary" onClick={() => onPreview(0)}>
            <BookIcon /> Preview
          </button>
          <button className="btn btn-primary" onClick={() => setExportOpen(true)} disabled={!hasPages}>
            <PrintIcon /> Print or save
          </button>
        </div>
      </div>

      {editingPage && (
        <PageSheet
          page={editingPage}
          folio={pageFolio(sides, book.pages.indexOf(editingPage))}
          preview={previewByPage.get(editingPage.id) ?? null}
          book={book}
          books={books}
          onUpdate={(patch) => onUpdatePage(editingPage.id, patch)}
          onCreateBook={onCreateBook}
          onClose={() => setEditing(null)}
          toast={toast}
        />
      )}

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

/** The page number page `index` of the book prints with. */
function pageFolio(sides: BookSide[], index: number): number {
  for (const side of sides) if (side.kind === 'page' && side.index === index) return side.folio
  return 0
}

/** Editing one page: whether it shows the colour guide, and which book it's in. */
function PageSheet({
  page,
  folio,
  preview,
  book,
  books,
  onUpdate,
  onCreateBook,
  onClose,
  toast,
}: {
  page: BookPage
  folio: number
  preview: string | null
  book: Book
  books: Book[]
  onUpdate: (patch: Partial<Pick<BookPageRecord, 'bookId' | 'hideGuide'>>) => Promise<void>
  onCreateBook: () => Promise<BookRecord>
  onClose: () => void
  toast: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const others = books.filter((b) => b.id !== book.id)
  const guide = !page.hideGuide

  const moveTo = async (target: Book | 'new') => {
    if (busy) return
    setBusy(true)
    try {
      const into = target === 'new' ? await onCreateBook() : target
      await onUpdate({ bookId: into.id })
      onClose()
      toast(`Moved to ${into.title}`)
    } catch {
      toast("Couldn't move the page")
      setBusy(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="sheet book-picker page-sheet" role="dialog" aria-modal="true" aria-label={`Page ${folio}`}>
        <header className="sheet-header">
          <span className="icon-btn-spacer" />
          <h2>Page {folio}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <CloseIcon />
          </button>
        </header>
        <div className="page-sheet-preview paper paper-small">
          {preview ? <img src={preview} alt={`Page ${folio}`} /> : <div className="spinner" />}
        </div>
        <button
          className="switch-row page-sheet-guide"
          role="switch"
          aria-checked={guide}
          onClick={() => onUpdate({ hideGuide: guide }).catch(() => toast("Couldn't change the page"))}
        >
          <SparkleIcon />
          <span>Color guide in the corner</span>
          <span className="switch" aria-hidden="true" />
        </button>
        <p className="page-sheet-heading">Move to another book</p>
        <ul className="book-picker-list">
          {others.map((other) => (
            <li key={other.id}>
              <button className="export-option" onClick={() => moveTo(other)} disabled={busy}>
                <BookIcon />
                <span>
                  <strong>{other.title}</strong>
                  <small>{pageCount(other.pages.length)}</small>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button className="export-option" onClick={() => moveTo('new')} disabled={busy}>
              <PlusIcon />
              <span>
                <strong>New book</strong>
                <small>Start a fresh coloring book with this page</small>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}
