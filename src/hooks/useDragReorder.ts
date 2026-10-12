import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/** How far a mouse moves before a press becomes a drag; a finger moving this far is scrolling. */
const SLOP = 6
/** How long a finger rests on an item before it lifts. */
const LONG_PRESS = 350
/** Near this many px from the scroller's top or bottom edge, the list scrolls by itself. */
const EDGE = 72
const MAX_SCROLL_SPEED = 14

interface Press {
  id: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  /** Where in the item it was grabbed, so it doesn't jump to the pointer. */
  grabX: number
  grabY: number
  width: number
  dragging: boolean
  timer?: number
}

export interface DragGhost {
  id: string
  width: number
}

/**
 * Drag to reorder, for lists that also scroll on touch screens: with a mouse an item lifts once it
 * moves a little, with a finger after a long press. Items are elements with `data-drag-id` inside
 * `list`; the dragged one follows the pointer as `ghost` (position it with `ghostRef`) while the
 * others make room. `onDrop` gets the new order of ids, only if it changed.
 */
export function useDragReorder(
  ids: string[],
  onDrop: (ids: string[]) => void,
  list: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>,
) {
  const [order, setOrder] = useState<string[] | null>(null)
  const [ghost, setGhost] = useState<DragGhost | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const press = useRef<Press | null>(null)
  const orderRef = useRef<string[] | null>(null)
  const idsRef = useRef(ids)
  idsRef.current = ids
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop
  // Where each item was before the last reorder, to slide it from there (FLIP).
  const before = useRef<Map<string, DOMRect> | null>(null)

  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[data-drag-id]') ?? [])]

  const placeGhost = () => {
    const p = press.current
    const el = ghostRef.current
    if (p && el) el.style.transform = `translate(${p.x - p.grabX}px, ${p.y - p.grabY}px) rotate(-3deg) scale(1.04)`
  }

  /** Moves the dragged item to wherever the pointer is over another item. */
  const hitTest = () => {
    const p = press.current
    const current = orderRef.current
    if (!p?.dragging || !current) return
    const target = document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>('[data-drag-id]')
    const over = target?.dataset.dragId
    if (!over || over === p.id || !list.current?.contains(target)) return
    const next = current.filter((id) => id !== p.id)
    next.splice(current.indexOf(over), 0, p.id)
    before.current = new Map(items().map((el) => [el.dataset.dragId!, el.getBoundingClientRect()]))
    orderRef.current = next
    setOrder(next)
  }

  useLayoutEffect(() => {
    const rects = before.current
    if (!rects) return
    before.current = null
    for (const el of items()) {
      const was = rects.get(el.dataset.dragId!)
      if (!was) continue
      const now = el.getBoundingClientRect()
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (!dx && !dy) continue
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 220,
        easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)',
      })
    }
  }, [order])

  const finish = useCallback((drop: boolean) => {
    const p = press.current
    press.current = null
    if (!p) return
    clearTimeout(p.timer)
    if (!p.dragging) return
    const next = orderRef.current
    orderRef.current = null
    setOrder(null)
    setGhost(null)
    // The press ends in a click on whatever is under it; that isn't meant as a tap.
    const swallow = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
    if (drop && next && next.some((id, i) => id !== idsRef.current[i])) dropRef.current(next)
  }, [])

  const lift = useCallback(() => {
    const p = press.current
    if (!p) return
    p.dragging = true
    orderRef.current = idsRef.current
    setOrder(idsRef.current)
    setGhost({ id: p.id, width: p.width })
    navigator.vibrate?.(10)
  }, [])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current
      if (!p || e.pointerId !== p.pointerId) return
      p.x = e.clientX
      p.y = e.clientY
      if (!p.dragging) {
        if (Math.hypot(p.x - p.startX, p.y - p.startY) < SLOP) return
        if (e.pointerType === 'mouse') lift()
        else return finish(false) // A finger moving before the long press is scrolling.
      }
      placeGhost()
      hitTest()
    }
    const up = (e: PointerEvent) => press.current?.pointerId === e.pointerId && finish(true)
    const cancel = (e: PointerEvent) => press.current?.pointerId === e.pointerId && finish(false)
    // While an item is lifted the finger drags it, not the page.
    const touchMove = (e: TouchEvent) => press.current?.dragging && e.preventDefault()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && finish(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    document.addEventListener('touchmove', touchMove, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      document.removeEventListener('touchmove', touchMove)
      finish(false)
    }
  }, [finish, lift])

  // Scroll by itself while the dragged item is held near the top or bottom edge.
  useEffect(() => {
    if (!ghost) return
    let frame = requestAnimationFrame(function step() {
      const p = press.current
      const el = scroller.current
      if (p && el) {
        const { top, bottom } = el.getBoundingClientRect()
        const near = p.y < top + EDGE ? p.y - (top + EDGE) : p.y > bottom - EDGE ? p.y - (bottom - EDGE) : 0
        if (near) {
          el.scrollTop += Math.max(-1, Math.min(1, near / EDGE)) * MAX_SCROLL_SPEED
          hitTest()
        }
      }
      frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [ghost])

  // Place the ghost under the pointer as soon as it's in the page.
  useLayoutEffect(() => placeGhost(), [ghost])

  /** Props for the element an item is picked up by. */
  const handle = (id: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || press.current) return
      const item = e.currentTarget.closest<HTMLElement>('[data-drag-id]') ?? e.currentTarget
      const rect = item.getBoundingClientRect()
      press.current = {
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        grabX: e.clientX - rect.left,
        grabY: e.clientY - rect.top,
        width: rect.width,
        dragging: false,
      }
      if (e.pointerType !== 'mouse') press.current.timer = window.setTimeout(lift, LONG_PRESS)
    },
    // A long press would otherwise open the picture's menu.
    onContextMenu: (e: Event | { preventDefault: () => void }) => e.preventDefault(),
  })

  return { order: order ?? ids, dragging: ghost?.id ?? null, ghost, ghostRef, handle }
}
