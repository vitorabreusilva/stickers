import type { CSSProperties, PointerEvent } from 'react'
import { fanLayout, PEEK, stickerCount, type FolderColor } from '../lib/folders'
import type { Sticker } from '../hooks/useStickers'

interface Props {
  name: string
  emoji: string
  items: Sticker[]
  color: FolderColor
  freshId: string | null
  onOpen: () => void
}

// Pressing pulls the stickers out (hover and focus do too, in CSS); letting go tucks them back.
// Set on the element directly so a press doesn't re-render the whole collection.
const press = (on: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
  e.currentTarget.toggleAttribute('data-pressed', on)
}

/** A frosted pouch with the newest few stickers of a group peeking out of the top. */
export function Folder({ name, emoji, items, color, freshId, onOpen }: Props) {
  const peek = items.slice(0, PEEK)
  const layout = fanLayout(peek.length)
  return (
    <button
      className="folder"
      data-color={color}
      aria-label={`${name}, ${stickerCount(items.length)}`}
      style={{ '--n': peek.length } as CSSProperties}
      onClick={onOpen}
      onPointerDown={press(true)}
      onPointerUp={press(false)}
      onPointerLeave={press(false)}
      onPointerCancel={press(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="folder-back" />
      {peek.map((sticker, i) => {
        const { rest, open, z } = layout[i]
        const style = {
          '--i': i,
          '--rest': `translate(${rest.x}%, ${rest.y}%) rotate(${rest.r}deg)`,
          '--open': `translate(${open.x}%, ${open.y}%) rotate(${open.r}deg)`,
          zIndex: z,
        } as CSSProperties
        return (
          <span key={sticker.id} className="folder-sticker" style={style}>
            <img
              className={sticker.id === freshId ? 'fresh' : undefined}
              src={sticker.url}
              alt=""
              decoding="async"
              draggable={false}
            />
          </span>
        )
      })}
      <span className="folder-front">
        <span className="folder-name">
          <span aria-hidden="true">{emoji}</span> {name}
        </span>
        <span className="folder-count">{stickerCount(items.length)}</span>
      </span>
    </button>
  )
}
