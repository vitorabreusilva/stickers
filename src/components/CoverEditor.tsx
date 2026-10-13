import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  COVER_BACKGROUNDS,
  COVER_KIND_NAMES,
  COVER_LAYOUT_NAMES,
  COVER_LAYOUTS,
  COVER_PALETTES,
  type BookCover,
  type CoverLayout,
} from '../lib/books'
import type { BookRecord } from '../lib/db'
import type { Book } from '../hooks/useColoringBooks'
import { ImageIcon } from './icons'

/** Every way a cover can look: one of the layouts of all the stickers, or one sticker. */
type CoverChoice = CoverLayout | BookCover['kind']

const CHOICES: CoverChoice[] = [...COVER_LAYOUTS, 'sticker', 'stamp']

const choiceName = (choice: CoverChoice) =>
  choice === 'sticker' || choice === 'stamp' ? COVER_KIND_NAMES[choice] : COVER_LAYOUT_NAMES[choice]

interface Props {
  book: Book
  /** Whether the picture a sticker was cut from is on this device. */
  hasPhoto: (stickerId: string) => boolean
  onUpdate: (patch: Partial<Omit<BookRecord, 'id'>>) => Promise<void>
  onDone: () => void
  toast: (message: string) => void
}

/** Customizing a book's cover, under its preview: colour, layout or one sticker, and the original picture. */
export function CoverEditor({ book, hasPhoto, onUpdate, onDone, toast }: Props) {
  // One of each sticker in the book, in page order.
  const stickers = useMemo(() => {
    const seen = new Map<string, Blob>()
    for (const page of book.pages) if (!seen.has(page.stickerId)) seen.set(page.stickerId, page.sticker)
    return [...seen].map(([id, blob]) => ({ id, blob }))
  }, [book.pages])
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map())
  useEffect(() => {
    const made = new Map(stickers.map((s) => [s.id, URL.createObjectURL(s.blob)]))
    setUrls(made)
    return () => made.forEach((url) => URL.revokeObjectURL(url))
  }, [stickers])

  const cover = book.cover && stickers.some((s) => s.id === book.cover!.stickerId) ? book.cover : undefined
  const current: CoverChoice = cover?.kind ?? book.layout
  const photoReady = !!cover && hasPhoto(cover.stickerId)

  const update = (patch: Partial<Omit<BookRecord, 'id'>>) => onUpdate(patch).catch(() => toast("Couldn't change the cover"))

  const choose = (choice: CoverChoice) => {
    if (choice === 'sticker' || choice === 'stamp') {
      const stickerId = cover?.stickerId ?? stickers[0]?.id
      if (stickerId) update({ cover: { kind: choice, stickerId, ...(cover?.photo && { photo: true }) } })
    } else {
      update({ layout: choice, cover: undefined })
    }
  }

  return (
    <section className="cover-editor" aria-label="Customize cover">
      <div className="cover-editor-scroll">
        <div className="cover-editor-row">
          <span className="cover-editor-label">Colour</span>
          <div className="swatches cover-swatches" role="radiogroup" aria-label="Cover colour">
            {COVER_BACKGROUNDS.map((bg) => (
              <button
                key={bg}
                role="radio"
                aria-checked={book.background === bg}
                aria-label={COVER_PALETTES[bg].name}
                className="swatch"
                style={{ '--folder': COVER_PALETTES[bg].paper } as CSSProperties}
                onClick={() => update({ background: bg })}
              />
            ))}
          </div>
        </div>

        <div className="cover-editor-layouts" role="radiogroup" aria-label="Cover layout">
          {CHOICES.map((choice) => {
            const single = choice === 'sticker' || choice === 'stamp'
            return (
              <button
                key={choice}
                role="radio"
                aria-checked={current === choice}
                className={current === choice ? 'active' : ''}
                disabled={single && !stickers.length}
                onClick={() => choose(choice)}
              >
                <LayoutGlyph layout={choice} />
                {choiceName(choice)}
              </button>
            )
          })}
        </div>

        {cover && (
          <>
            <div className="cover-editor-stickers" role="radiogroup" aria-label="Cover sticker">
              {stickers.map((sticker) => (
                <button
                  key={sticker.id}
                  role="radio"
                  aria-checked={sticker.id === cover.stickerId}
                  aria-label="Sticker for the cover"
                  className={sticker.id === cover.stickerId ? 'active' : ''}
                  onClick={() => update({ cover: { ...cover, stickerId: sticker.id } })}
                >
                  {urls.get(sticker.id) && <img src={urls.get(sticker.id)} alt="" draggable={false} />}
                </button>
              ))}
            </div>

            <button
              className="switch-row cover-editor-photo"
              role="switch"
              aria-checked={!!cover.photo && photoReady}
              disabled={!photoReady}
              onClick={() => update({ cover: { kind: cover.kind, stickerId: cover.stickerId, ...(!cover.photo && { photo: true }) } })}
            >
              <ImageIcon />
              <span>
                Use the original picture
                <small>
                  {photoReady
                    ? 'Fills the whole cover, behind the title.'
                    : "This sticker was made before the app kept original pictures."}
                </small>
              </span>
              <span className="switch" aria-hidden="true" />
            </button>
          </>
        )}
        {!stickers.length && <p className="cover-editor-hint">Add pages to the book to put their stickers on the cover.</p>}
      </div>

      <button className="btn btn-primary cover-editor-done" onClick={onDone}>
        Done
      </button>
    </section>
  )
}

/** A tiny sketch of each cover layout, for its button. */
function LayoutGlyph({ layout }: { layout: CoverChoice }) {
  if (layout === 'stamp') {
    return (
      <svg className="layout-glyph" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="2.5" width="14" height="15" rx="0.8" strokeDasharray="1.4 1.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x="5.5" y="5" width="9" height="8.5" rx="1" />
      </svg>
    )
  }
  const boxes: Record<CoverLayout | 'sticker', [number, number, number, number, number][]> = {
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
    sticker: [[3, 3, 14, 14, -5]],
  }
  return (
    <svg className="layout-glyph" viewBox="0 0 20 20" aria-hidden="true">
      {boxes[layout].map(([x, y, w, h, r], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="1.6" transform={`rotate(${r} ${x + w / 2} ${y + h / 2})`} />
      ))}
    </svg>
  )
}
