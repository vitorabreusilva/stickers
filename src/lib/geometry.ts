export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Drops points closer than `minDistance` to the previously kept point. */
export function decimate(points: Point[], minDistance: number): Point[] {
  if (points.length === 0) return []
  const out = [points[0]]
  for (let i = 1; i < points.length; i++) {
    if (distance(points[i], out[out.length - 1]) >= minDistance) out.push(points[i])
  }
  return out
}

/** Chaikin corner-cutting on a closed polygon; each pass doubles the vertex count. */
export function smoothClosed(points: Point[], passes = 2): Point[] {
  let current = points
  for (let pass = 0; pass < passes && current.length >= 3; pass++) {
    const next: Point[] = []
    for (let i = 0; i < current.length; i++) {
      const a = current[i]
      const b = current[(i + 1) % current.length]
      next.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y })
      next.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y })
    }
    current = next
  }
  return current
}

/** Absolute area of a closed polygon (shoelace formula). */
export function polygonArea(points: Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** Area centroid of a closed polygon; falls back to the vertex average for degenerate ones. */
export function polygonCentroid(points: Point[]): Point {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const cross = a.x * b.y - b.x * a.y
    area += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }
  if (Math.abs(area) < 1e-9) {
    const n = points.length || 1
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n }
  }
  return { x: cx / (3 * area), y: cy / (3 * area) }
}

export function boundingBox(points: Point[]): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (minX > maxX) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Snaps a rect outward to whole pixels and clips it to `bounds`. */
export function intersectRect(rect: Rect, bounds: Rect): Rect {
  const x0 = Math.max(Math.floor(rect.x), bounds.x)
  const y0 = Math.max(Math.floor(rect.y), bounds.y)
  const x1 = Math.min(Math.ceil(rect.x + rect.width), bounds.x + bounds.width)
  const y1 = Math.min(Math.ceil(rect.y + rect.height), bounds.y + bounds.height)
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

/** Turns a raw freehand stroke into a clean closed loop, or null if it's too small to be a selection. */
export function finishLasso(raw: Point[], minDistance: number, minArea: number): Point[] | null {
  const pts = decimate(raw, minDistance)
  if (pts.length < 3) return null
  const loop = smoothClosed(pts, 2)
  return polygonArea(loop) >= minArea ? loop : null
}
