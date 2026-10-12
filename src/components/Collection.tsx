import { useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'
import { firstImageFile } from '../lib/device'
import type { Sticker } from '../hooks/useStickers'
import { PasteIcon, PlusIcon, StarMascot } from './icons'

interface Props {
  stickers: Sticker[] | null
  freshId: string | null
  canPaste: boolean
  onImage: (file: Blob) => void
  onPaste: () => void
  onOpen: (id: string) => void
}

/** A stable, slightly playful rotation per sticker so the grid looks hand-placed. */
function tilt(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return ((Math.abs(hash) % 15) - 7) * 0.9
}

export function Collection({ stickers, freshId, canPaste, onImage, onPaste, onOpen }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = firstImageFile(e.target.files)
    e.target.value = ''
    if (file) onImage(file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = firstImageFile(e.dataTransfer.files)
    if (file) onImage(file)
  }

  const count = stickers?.length ?? 0

  return (
    <div
      className="collection"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="collection-header">
        <h1>
          Stickers
          {count > 0 && <span className="count">{count}</span>}
        </h1>
      </header>

      {stickers && count === 0 && (
        <section className="empty">
          <StarMascot />
          <h2>Your sticker book is empty</h2>
          <p>
            Pick a picture you love, draw a loop around the good part, and it becomes a sticker.
            {canPaste && ' You can also copy an image in your browser and paste it here.'}
          </p>
        </section>
      )}

      {count > 0 && (
        <ul className="grid" aria-label="Your stickers">
          {stickers!.map((sticker) => (
            <li key={sticker.id} style={{ '--tilt': `${tilt(sticker.id)}deg` } as CSSProperties}>
              <button
                className={`grid-item${sticker.id === freshId ? ' fresh' : ''}`}
                onClick={() => onOpen(sticker.id)}
                aria-label="Open sticker"
              >
                <img src={sticker.url} alt="" loading="lazy" decoding="async" draggable={false} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="dock">
        {canPaste && (
          <button className="btn btn-secondary" onClick={onPaste}>
            <PasteIcon /> Paste
          </button>
        )}
        <button className="btn btn-primary btn-big" onClick={() => inputRef.current?.click()}>
          <PlusIcon /> New sticker
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          hidden
          data-testid="file-input"
        />
      </div>

      {dragging && <div className="drop-hint">Drop an image to make a sticker</div>}
    </div>
  )
}
