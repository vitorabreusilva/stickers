import { useEffect, useRef, useState } from 'react'
import { distance, finishLasso, type Point } from '../lib/geometry'
import type { LoadedImage } from '../lib/image'
import { traceLoop } from '../lib/sticker'
import { BackIcon, ExpandIcon, ScissorsIcon } from './icons'

interface View {
  scale: number
  x: number
  y: number
}

interface Props {
  image: LoadedImage
  onClose: () => void
  onCut: (loop: Point[]) => void
}

const MAX_ZOOM = 8
// Selections smaller than this (in screen pixels) are treated as accidental taps.
const MIN_LOOP_SIZE = 36

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function LassoEditor({ image, onClose, onCut }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loop, setLoop] = useState<Point[] | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const [nudge, setNudge] = useState(false)
  const resetView = useRef<() => void>(() => {})

  // Gesture and view state lives in a ref: it changes on every pointer move and only the canvas cares.
  const s = useRef({
    view: { scale: 1, x: 0, y: 0 } as View,
    fit: { scale: 1, x: 0, y: 0 } as View,
    width: 0,
    height: 0,
    pointers: new Map<number, Point>(),
    stroke: null as { pointerId: number; points: Point[] } | null,
    pinch: null as { anchor: Point; startDistance: number; startScale: number } | null,
    pan: null as { pointerId: number; last: Point } | null,
    loop: null as Point[] | null,
    dirty: true,
  }).current

  // Keep the canvas's copy of the loop in sync with React state (Redraw / whole-image buttons).
  useEffect(() => {
    s.loop = loop
    s.dirty = true
  }, [loop, s])

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!

    const toImage = (p: Point): Point => ({ x: (p.x - s.view.x) / s.view.scale, y: (p.y - s.view.y) / s.view.scale })
    const toScreen = (p: Point): Point => ({ x: p.x * s.view.scale + s.view.x, y: p.y * s.view.scale + s.view.y })
    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const setView = (next: View) => {
      const scale = clamp(next.scale, s.fit.scale, s.fit.scale * MAX_ZOOM)
      // Keep the picture covering the middle of the screen so it can't be flung away.
      const cx = s.width / 2
      const cy = s.height / 2
      s.view = {
        scale,
        x: clamp(next.x, cx - image.width * scale, cx),
        y: clamp(next.y, cy - image.height * scale, cy),
      }
      s.dirty = true
      setZoomed(scale > s.fit.scale * 1.02)
    }

    const zoomAt = (p: Point, factor: number) => {
      const anchor = toImage(p)
      const scale = clamp(s.view.scale * factor, s.fit.scale, s.fit.scale * MAX_ZOOM)
      setView({ scale, x: p.x - anchor.x * scale, y: p.y - anchor.y * scale })
    }

    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect()
      if (!width || !height) return
      const wasFit = s.view.scale <= s.fit.scale * 1.02
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      s.width = width
      s.height = height
      const margin = 24
      const scale = Math.min((width - margin * 2) / image.width, (height - margin * 2) / image.height)
      s.fit = { scale, x: (width - image.width * scale) / 2, y: (height - image.height * scale) / 2 }
      if (wasFit) s.view = { ...s.fit }
      setView(s.view)
    }

    const startPinch = () => {
      const [a, b] = [...s.pointers.values()]
      s.pinch = { anchor: toImage(midpoint(a, b)), startDistance: Math.max(distance(a, b), 1), startScale: s.view.scale }
    }

    const finishStroke = () => {
      const stroke = s.stroke
      s.stroke = null
      if (!stroke) return
      const scale = s.view.scale
      const next = finishLasso(stroke.points, 2 / scale, (MIN_LOOP_SIZE * MIN_LOOP_SIZE) / (scale * scale))
      if (next) {
        s.loop = next
        setLoop(next)
        setNudge(false)
      } else if (!s.loop) {
        setNudge(true)
      }
    }

    const onDown = (e: PointerEvent) => {
      const p = local(e)
      if (e.pointerType === 'mouse' && e.button !== 0) {
        // Middle/right drag pans on desktop.
        s.pan = { pointerId: e.pointerId, last: p }
        canvas.setPointerCapture(e.pointerId)
        return
      }
      canvas.setPointerCapture(e.pointerId)
      s.pointers.set(e.pointerId, p)
      if (s.pointers.size === 1) {
        s.stroke = { pointerId: e.pointerId, points: [toImage(p)] }
      } else if (s.pointers.size === 2) {
        // A second finger means "zoom", not "draw": drop the stroke and keep the previous loop.
        s.stroke = null
        startPinch()
      }
      s.dirty = true
    }

    const onMove = (e: PointerEvent) => {
      if (s.pan?.pointerId === e.pointerId) {
        const p = local(e)
        setView({ ...s.view, x: s.view.x + p.x - s.pan.last.x, y: s.view.y + p.y - s.pan.last.y })
        s.pan.last = p
        return
      }
      if (!s.pointers.has(e.pointerId)) return
      s.pointers.set(e.pointerId, local(e))

      if (s.pinch && s.pointers.size >= 2) {
        const [a, b] = [...s.pointers.values()]
        const scale = s.pinch.startScale * (distance(a, b) / s.pinch.startDistance)
        const c = midpoint(a, b)
        setView({ scale, x: c.x - s.pinch.anchor.x * scale, y: c.y - s.pinch.anchor.y * scale })
      } else if (s.stroke?.pointerId === e.pointerId) {
        const events = e.getCoalescedEvents?.() ?? []
        for (const ev of events.length ? events : [e]) {
          const p = toImage(local(ev))
          const last = s.stroke.points[s.stroke.points.length - 1]
          if (distance(p, last) * s.view.scale >= 1.5) s.stroke.points.push(p)
        }
        s.dirty = true
      }
    }

    const onUp = (e: PointerEvent) => {
      if (s.pan?.pointerId === e.pointerId) {
        s.pan = null
        return
      }
      if (!s.pointers.delete(e.pointerId)) return
      if (s.stroke?.pointerId === e.pointerId) {
        if (e.type === 'pointercancel') s.stroke = null
        else finishStroke()
      }
      if (s.pointers.size < 2) s.pinch = null
      s.dirty = true
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Trackpad pinches arrive as ctrl+wheel with small deltas; mouse wheels zoom more gently.
      const speed = e.ctrlKey ? 0.01 : 0.0015
      zoomAt(local(e), Math.exp(-e.deltaY * speed))
    }

    const preventMenu = (e: Event) => e.preventDefault()

    const draw = (time: number) => {
      const dpr = canvas.width / (s.width || 1)
      const { view } = s
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image.source, 0, 0, image.width, image.height)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      if (s.stroke && s.stroke.points.length > 1) {
        const pts = s.stroke.points.map(toScreen)
        // Faint closing line shows how the loop will be completed.
        ctx.beginPath()
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
        ctx.lineTo(pts[0].x, pts[0].y)
        ctx.setLineDash([4, 6])
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.stroke()
        ctx.setLineDash([])

        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        for (const p of pts) ctx.lineTo(p.x, p.y)
        ctx.lineWidth = 7
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'
        ctx.stroke()
        ctx.lineWidth = 3.5
        ctx.strokeStyle = '#ff3d7f'
        ctx.stroke()
      } else if (s.loop) {
        const pts = s.loop.map(toScreen)
        ctx.beginPath()
        ctx.rect(0, 0, s.width, s.height)
        traceLoop(ctx, pts)
        ctx.fillStyle = 'rgba(14, 10, 26, 0.62)'
        ctx.fill('evenodd')

        ctx.beginPath()
        traceLoop(ctx, pts)
        ctx.lineWidth = 3
        ctx.strokeStyle = '#fff'
        ctx.stroke()
        ctx.setLineDash([10, 8])
        ctx.lineDashOffset = -time / 40
        ctx.strokeStyle = '#ff3d7f'
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    let raf = 0
    const tick = (time: number) => {
      // The loop's "marching ants" need every frame; otherwise only redraw on change.
      if (s.dirty || (s.loop && !s.stroke)) {
        s.dirty = false
        draw(time)
      }
      raf = requestAnimationFrame(tick)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    raf = requestAnimationFrame(tick)

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', preventMenu)
    resetView.current = () => setView({ ...s.fit })

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', preventMenu)
    }
  }, [image, s])

  const wholeImage = () => {
    const { width: w, height: h } = image
    onCut([
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ])
  }

  return (
    <div className="editor">
      <header className="editor-bar">
        <button className="icon-btn" onClick={onClose} aria-label="Back to collection">
          <BackIcon />
        </button>
        <h1 className="editor-title">{loop ? 'Looks good?' : 'Circle your sticker'}</h1>
        <button
          className="icon-btn"
          onClick={() => resetView.current()}
          aria-label="Fit picture to screen"
          style={{ visibility: zoomed ? 'visible' : 'hidden' }}
        >
          <ExpandIcon />
        </button>
      </header>

      <div className="editor-stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="editor-canvas" data-testid="lasso-canvas" />
      </div>

      <footer className="editor-actions">
        {loop ? (
          <>
            <button className="btn btn-ghost-dark" onClick={() => setLoop(null)}>
              Redraw
            </button>
            <button className="btn btn-primary" onClick={() => onCut(loop)}>
              <ScissorsIcon /> Cut sticker
            </button>
          </>
        ) : (
          <>
            <p className={`editor-hint${nudge ? ' editor-hint-nudge' : ''}`}>
              {nudge ? 'Draw a bigger loop around the part you want' : 'Draw a loop around the part you want. Pinch to zoom.'}
            </p>
            <button className="btn btn-ghost-dark" onClick={wholeImage}>
              Use whole picture
            </button>
          </>
        )}
      </footer>
    </div>
  )
}
