import type { CSSProperties } from 'react'
import type { Sticker } from '../hooks/useStickers'

interface Props {
  items: Sticker[]
  label: string
  freshId: string | null
  onOpen: (id: string) => void
}

/** A stable, slightly playful rotation per sticker so the grid looks hand-placed. */
function tilt(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return ((Math.abs(hash) % 15) - 7) * 0.9
}

export function StickerGrid({ items, label, freshId, onOpen }: Props) {
  return (
    <ul className="grid" aria-label={label}>
      {items.map((sticker) => (
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
  )
}
