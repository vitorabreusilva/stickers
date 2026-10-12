import { FOLDER_COLOR_NAMES, FOLDER_COLORS, stickerCount, type FolderColor } from '../lib/folders'
import type { Sticker } from '../hooks/useStickers'
import { StickerGrid } from './StickerGrid'
import { BackIcon } from './icons'

interface Props {
  name: string
  emoji: string
  items: Sticker[]
  color: FolderColor
  freshId: string | null
  onColor: (color: FolderColor) => void
  onOpen: (id: string) => void
  onClose: () => void
}

/** An opened folder: its stickers in a grid, and swatches to recolour it. */
export function FolderView({ name, emoji, items, color, freshId, onColor, onOpen, onClose }: Props) {
  return (
    <div className="folder-view" role="dialog" aria-modal="true" aria-label={name}>
      <div className="folder-view-inner">
        <header className="folder-view-bar">
          <button className="icon-btn folder-view-back" onClick={onClose} aria-label="Back">
            <BackIcon />
          </button>
        </header>

        <section className="folder-hero" data-color={color}>
          <h2>
            <span aria-hidden="true">{emoji}</span> {name}
          </h2>
          <p>{stickerCount(items.length)}</p>
          <div className="swatches" role="radiogroup" aria-label="Folder colour">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                className="swatch"
                data-color={c}
                role="radio"
                aria-checked={c === color}
                aria-label={FOLDER_COLOR_NAMES[c]}
                onClick={() => onColor(c)}
              />
            ))}
          </div>
        </section>

        {items.length > 0 ? (
          <StickerGrid items={items} label={name} freshId={freshId} onOpen={onOpen} />
        ) : (
          <p className="folder-empty">Nothing in here anymore.</p>
        )}
      </div>
    </div>
  )
}
