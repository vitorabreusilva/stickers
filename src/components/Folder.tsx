import { useRef, type CSSProperties, type PointerEvent } from 'react'
import { fanLayout, PEEK, stickerCount, type FolderColor } from '../lib/folders'
import type { Sticker } from '../hooks/useStickers'

interface Props {
  name: string
  emoji: string
  items: Sticker[]
  color: FolderColor
  freshId: string | null
  onOpen: () => void
  /** Right-click, or press and hold on a touch screen: the folder's settings. */
  onMenu?: () => void
}

/** How long a press on a touch screen lasts before it opens the menu instead. */
const HOLD_MS = 500
/** A finger that moves this far is scrolling, not holding. */
const HOLD_SLOP = 10

// Pressing pulls the stickers out (hover and focus do too, in CSS); letting go tucks them back.
// Set on the element directly so a press doesn't re-render the whole collection.
const press = (e: PointerEvent<HTMLButtonElement>, on: boolean) => {
  e.currentTarget.toggleAttribute('data-pressed', on)
}

/** A frosted pouch with the newest few stickers of a group peeking out of the top. */
export function Folder({ name, emoji, items, color, freshId, onOpen, onMenu }: Props) {
  const peek = items.slice(0, PEEK)
  const layout = fanLayout(peek.length)
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null)
  // The menu opened during this press, so letting go mustn't open the folder too.
  const held = useRef(false)

  const cancelHold = () => {
    if (hold.current) clearTimeout(hold.current.timer)
    hold.current = null
  }
  const release = (e: PointerEvent<HTMLButtonElement>) => {
    press(e, false)
    cancelHold()
  }

  return (
    <button
      className="folder"
      data-color={color}
      aria-label={`${name}, ${stickerCount(items.length)}`}
      aria-haspopup={onMenu ? 'dialog' : undefined}
      style={{ '--n': peek.length } as CSSProperties}
      onClick={() => {
        if (held.current) held.current = false
        else onOpen()
      }}
      onPointerDown={(e) => {
        press(e, true)
        held.current = false
        // Mice have right-click for the menu; fingers and pens hold.
        if (!onMenu || e.pointerType === 'mouse') return
        const target = e.currentTarget
        hold.current = {
          x: e.clientX,
          y: e.clientY,
          timer: window.setTimeout(() => {
            hold.current = null
            held.current = true
            target.removeAttribute('data-pressed')
            navigator.vibrate?.(12)
            onMenu()
          }, HOLD_MS),
        }
      }}
      onPointerMove={(e) => {
        const start = hold.current
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_SLOP) cancelHold()
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(e) => {
        e.preventDefault()
        // On Android a long press fires this too, after the hold already opened the menu.
        if (!onMenu || held.current) return
        cancelHold()
        onMenu()
      }}
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
