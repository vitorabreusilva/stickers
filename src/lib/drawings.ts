// Simple cartoon drawings with thick outlines, used as a reference for "this sticker is a
// drawing" (cartoons, emoji, clip art). Drawn at runtime so no artwork ships with the app.

type Ctx = OffscreenCanvasRenderingContext2D

const INK = '#3a2216'

function outlined(ctx: Ctx, path: () => void, fill: string, width = 9) {
  ctx.beginPath()
  path()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = width
  ctx.strokeStyle = INK
  ctx.stroke()
}

function face(ctx: Ctx, x: number, y: number, s: number) {
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.ellipse(x - 22 * s, y, 8 * s, 11 * s, 0, 0, Math.PI * 2)
  ctx.ellipse(x + 22 * s, y, 8 * s, 11 * s, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 7 * s
  ctx.strokeStyle = INK
  ctx.beginPath()
  ctx.arc(x, y + 14 * s, 22 * s, 0.25, Math.PI - 0.25)
  ctx.stroke()
}

const DRAWINGS: ((ctx: Ctx) => void)[] = [
  // Star
  (ctx) => {
    outlined(ctx, () => {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 70 : 150
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        ctx.lineTo(192 + r * Math.cos(a), 200 + r * Math.sin(a))
      }
      ctx.closePath()
    }, '#ffd23f')
    face(ctx, 192, 205, 1)
  },
  // Sun
  (ctx) => {
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6
      outlined(ctx, () => {
        ctx.moveTo(192 + 100 * Math.cos(a - 0.15), 192 + 100 * Math.sin(a - 0.15))
        ctx.lineTo(192 + 165 * Math.cos(a), 192 + 165 * Math.sin(a))
        ctx.lineTo(192 + 100 * Math.cos(a + 0.15), 192 + 100 * Math.sin(a + 0.15))
      }, '#ff9f1c', 7)
    }
    outlined(ctx, () => ctx.arc(192, 192, 105, 0, Math.PI * 2), '#ffd23f')
    face(ctx, 192, 185, 1.3)
  },
  // Heart
  (ctx) => {
    outlined(ctx, () => {
      ctx.moveTo(192, 330)
      ctx.bezierCurveTo(20, 220, 40, 60, 192, 120)
      ctx.bezierCurveTo(344, 60, 364, 220, 192, 330)
    }, '#ff4d6d')
    face(ctx, 192, 190, 1.1)
  },
  // Cat head
  (ctx) => {
    outlined(ctx, () => {
      ctx.moveTo(80, 170)
      ctx.lineTo(95, 50)
      ctx.lineTo(170, 110)
      ctx.lineTo(214, 110)
      ctx.lineTo(289, 50)
      ctx.lineTo(304, 170)
      ctx.ellipse(192, 210, 125, 110, 0, 0, Math.PI)
      ctx.closePath()
    }, '#f4a259')
    face(ctx, 192, 200, 1.2)
    ctx.lineWidth = 5
    for (const dir of [-1, 1]) for (const dy of [-10, 10]) {
      ctx.beginPath()
      ctx.moveTo(192 + dir * 60, 240 + dy)
      ctx.lineTo(192 + dir * 140, 230 + dy * 2)
      ctx.stroke()
    }
  },
  // Flower
  (ctx) => {
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3
      outlined(ctx, () => ctx.ellipse(192 + 95 * Math.cos(a), 192 + 95 * Math.sin(a), 70, 50, a, 0, Math.PI * 2), '#c77dff', 8)
    }
    outlined(ctx, () => ctx.arc(192, 192, 75, 0, Math.PI * 2), '#ffd23f')
    face(ctx, 192, 185, 0.9)
  },
  // Ghost
  (ctx) => {
    outlined(ctx, () => {
      ctx.moveTo(90, 320)
      ctx.lineTo(90, 170)
      ctx.arc(192, 170, 102, Math.PI, 0)
      ctx.lineTo(294, 320)
      for (let i = 0; i < 4; i++) ctx.quadraticCurveTo(294 - 25.5 * (2 * i + 1), 290, 294 - 51 * (i + 1), 320)
      ctx.closePath()
    }, '#e0f2ff')
    face(ctx, 192, 175, 1.2)
  },
]

/** Renders each reference drawing on white at `size`×`size`, the way stickers are analysed. */
export function* referenceDrawings(size = 384): Generator<OffscreenCanvas> {
  for (const draw of DRAWINGS) {
    const canvas = new OffscreenCanvas(size, size)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    ctx.scale(size / 384, size / 384)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    draw(ctx)
    yield canvas
  }
}
