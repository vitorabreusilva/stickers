import { stickerCount, type FolderColor } from '../lib/folders'
import type { Sticker } from '../hooks/useStickers'
import { StickerGrid } from './StickerGrid'
import { BackIcon, SettingsIcon } from './icons'

interface Props {
  name: string
  emoji: string
  items: Sticker[]
  color: FolderColor
  freshId: string | null
  onSettings: () => void
  onOpen: (id: string) => void
  onClose: () => void
}

/** An opened folder: its stickers in a grid, with its settings a tap away. */
export function FolderView({ name, emoji, items, color, freshId, onSettings, onOpen, onClose }: Props) {
  return (
    <div className="folder-view" role="dialog" aria-modal="true" aria-label={name}>
      <div className="folder-view-inner">
        <header className="folder-view-bar">
          <button className="icon-btn folder-view-btn" onClick={onClose} aria-label="Back">
            <BackIcon />
          </button>
          <button className="icon-btn folder-view-btn" onClick={onSettings} aria-label="Folder settings" aria-haspopup="dialog">
            <SettingsIcon />
          </button>
        </header>

        <section className="folder-hero" data-color={color}>
          <h2>
            <span aria-hidden="true">{emoji}</span> {name}
          </h2>
          <p>{stickerCount(items.length)}</p>
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
