import { useEffect, useState } from 'react'
import { composeCover, pagesToPdf, printPages, type CoverSticker } from '../lib/book-render'
import { DEFAULT_TITLE, storeBookTitle, storedBookTitle } from '../lib/book-title'
import { downloadBlob } from '../lib/device'
import { canvasToBlob } from '../lib/image'
import type { BookPage } from '../hooks/useColoringBook'
import { BackIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, PrintIcon } from './icons'

interface Props {
  pages: BookPage[]
  onRemove: (id: string) => Promise<void>
  onMove: (id: string, by: number) => Promise<void>
  onClose: () => void
  toast: (message: string) => void
}

function savedTitle() {
  return storedBookTitle() ?? DEFAULT_TITLE
}

/** Every sticker used in the book, once each, in page order. */
function coverStickers(pages: BookPage[]): CoverSticker[] {
  const seen = new Set<string>()
  const out: CoverSticker[] = []
  for (const page of pages) {
    if (seen.has(page.stickerId)) continue
    seen.add(page.stickerId)
    out.push({ blob: page.sticker, effect: page.effect })
  }
  return out
}

/** The coloring book: a cover made of its stickers, its pages, and printing. */
export function BookView({ pages, onRemove, onMove, onClose, toast }: Props) {
  const [title, setTitle] = useState(savedTitle)
  const [cover, setCover] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Redraw the cover when the pages or the title change, once typing pauses.
  useEffect(() => {
    if (!pages.length) {
      setCover(null)
      return
    }
    let cancelled = false
    let url: string | undefined
    const timer = setTimeout(async () => {
      try {
        const canvas = await composeCover(coverStickers(pages), title, pages.length)
        const blob = await canvasToBlob(canvas)
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setCover({ canvas, url })
      } catch (err) {
        console.error('Could not draw the cover', err)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000)
    }
  }, [pages, title])

  const changeTitle = (value: string) => {
    setTitle(value)
    storeBookTitle(value)
  }

  const savePdf = async () => {
    if (!cover || busy) return
    setBusy(true)
    try {
      const pdf = await pagesToPdf(
        pages.map((p) => p.page),
        cover.canvas,
      )
      const name = (title.trim() || DEFAULT_TITLE).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
      downloadBlob(pdf, `${name || 'coloring-book'}.pdf`)
    } catch (err) {
      console.error(err)
      toast("Couldn't make the PDF")
    } finally {
      setBusy(false)
    }
  }

  const print = () => {
    if (!cover) return
    printPages([cover.url, ...pages.map((p) => p.url)]).catch(() => toast("Couldn't open printing"))
  }

  const remove = async (id: string) => {
    if (confirming !== id) {
      setConfirming(id)
      return
    }
    setConfirming(null)
    try {
      await onRemove(id)
    } catch {
      toast("Couldn't remove the page")
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
          <span className="icon-btn-spacer" />
        </header>

        {pages.length === 0 ? (
          <section className="empty">
            <h2>No pages yet</h2>
            <p>Open a sticker and tap Color to turn it into a coloring page, then add it to your book.</p>
          </section>
        ) : (
          <>
            <label className="book-title">
              <span>Title</span>
              <input value={title} maxLength={40} onChange={(e) => changeTitle(e.target.value)} placeholder={DEFAULT_TITLE} />
            </label>

            <ol className="book-pages" aria-label="Pages">
              <li className="book-page">
                <div className="paper paper-small">
                  {cover ? <img src={cover.url} alt="Cover" data-testid="book-cover" /> : <div className="spinner" />}
                </div>
                <span className="book-page-label">Cover</span>
              </li>
              {pages.map((page, i) => (
                <li key={page.id} className="book-page">
                  <div className="paper paper-small">
                    <img src={page.url} alt={`Page ${i + 1}`} loading="lazy" />
                  </div>
                  <div className="book-page-tools">
                    <button
                      className="icon-btn"
                      onClick={() => onMove(page.id, -1)}
                      disabled={i === 0}
                      aria-label={`Move page ${i + 1} earlier`}
                    >
                      <ChevronLeftIcon />
                    </button>
                    <span className="book-page-label">{i + 1}</span>
                    <button
                      className="icon-btn"
                      onClick={() => onMove(page.id, 1)}
                      disabled={i === pages.length - 1}
                      aria-label={`Move page ${i + 1} later`}
                    >
                      <ChevronRightIcon />
                    </button>
                  </div>
                  <button
                    className={`book-page-remove${confirming === page.id ? ' confirming' : ''}`}
                    onClick={() => remove(page.id)}
                    onBlur={() => confirming === page.id && setConfirming(null)}
                    aria-label={confirming === page.id ? `Really remove page ${i + 1}?` : `Remove page ${i + 1}`}
                  >
                    {confirming === page.id ? 'Remove?' : <CloseIcon />}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}

        {pages.length > 0 && (
          <div className="book-actions book-actions-docked">
            <button className="btn btn-secondary" onClick={print} disabled={!cover}>
              <PrintIcon /> Print
            </button>
            <button className="btn btn-primary" onClick={savePdf} disabled={!cover || busy}>
              <DownloadIcon /> {busy ? 'Making PDF…' : 'Save PDF'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
