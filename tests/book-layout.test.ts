import { describe, expect, it } from 'vitest'
import {
  ART_BOX,
  bookletSheets,
  bookSides,
  bookSpreads,
  collageLayout,
  coverLayout,
  FOOTER_BOX,
  fitBox,
  GUIDE_BOX,
  hasLegacyGuide,
  isRecto,
  LEGACY_BASELINE,
  PAGE_PX,
  tidyLayout,
  type Placement,
} from '../src/lib/book-layout'
import { COVER_LAYOUTS } from '../src/lib/books'

describe('page geometry', () => {
  it('is A5 at 300 dpi with the drawing and footer inside the margins', () => {
    expect(PAGE_PX).toEqual({ width: 1748, height: 2480 })
    expect(ART_BOX.x).toBeGreaterThan(0)
    expect(FOOTER_BOX.y).toBeGreaterThan(ART_BOX.y + ART_BOX.height)
    expect(FOOTER_BOX.y + FOOTER_BOX.height).toBeLessThan(PAGE_PX.height)
    expect(GUIDE_BOX.x + GUIDE_BOX.width).toBe(FOOTER_BOX.x + FOOTER_BOX.width)
  })

  it('fits keeping proportions', () => {
    const box = fitBox(2, { x: 0, y: 0, width: 100, height: 100 })
    expect(box).toEqual({ x: 0, y: 25, width: 100, height: 50 })
  })
})

const box = { x: 100, y: 200, width: 1000, height: 1400 }

function bounds(p: Placement) {
  const halfW = (p.width * Math.abs(Math.cos(p.rotation)) + p.height * Math.abs(Math.sin(p.rotation))) / 2
  const halfH = (p.width * Math.abs(Math.sin(p.rotation)) + p.height * Math.abs(Math.cos(p.rotation))) / 2
  return { left: p.cx - halfW, right: p.cx + halfW, top: p.cy - halfH, bottom: p.cy + halfH }
}

describe('cover layouts', () => {
  describe.each(COVER_LAYOUTS)('%s', (layout) => {
    it.each([1, 2, 3, 7, 20])('places %i stickers on the cover without leaving it', (n) => {
      const aspects = Array.from({ length: n }, (_, i) => [1, 0.7, 1.5, 4][i % 4])
      const placements = coverLayout(layout, aspects, box)
      expect(placements).toHaveLength(n)
      placements.forEach((p, i) => {
        const b = bounds(p)
        expect(b.left).toBeGreaterThanOrEqual(box.x - 0.5)
        expect(b.right).toBeLessThanOrEqual(box.x + box.width + 0.5)
        expect(b.top).toBeGreaterThanOrEqual(box.y - 0.5)
        expect(b.bottom).toBeLessThanOrEqual(box.y + box.height + 0.5)
        expect(p.width / p.height).toBeCloseTo(aspects[i], 5)
      })
    })

    it('looks the same every time', () => {
      expect(coverLayout(layout, [1, 1, 1], box)).toEqual(coverLayout(layout, [1, 1, 1], box))
    })
  })

  it('keeps the playful collage as it was', () => {
    expect(coverLayout('playful', [1, 0.5], box)).toEqual(collageLayout([1, 0.5], box))
  })

  it('lines tidy stickers up upright, without overlapping', () => {
    const placements = tidyLayout([1, 1, 1, 1, 1], box)
    expect(placements.every((p) => p.rotation === 0)).toBe(true)
    const boxes = placements.map(bounds)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true)
      }
    }
  })

  it('makes the spotlight sticker the biggest', () => {
    const [hero, ...rest] = coverLayout('spotlight', [1, 1, 1, 1], box)
    for (const p of rest) expect(hero.width * hero.height).toBeGreaterThan(4 * p.width * p.height)
  })
})

describe('bookSides', () => {
  it('rounds the pages up to whole sheets with blanks, inside the four sides of the cover', () => {
    const sides = bookSides(6)
    expect(sides).toHaveLength(12)
    expect(sides.map((s) => s.kind)).toEqual([
      'cover',
      'inside-cover',
      'page',
      'page',
      'page',
      'page',
      'page',
      'page',
      'blank',
      'blank',
      'inside-back',
      'back',
    ])
    expect(sides[2]).toEqual({ kind: 'page', index: 0, folio: 1 })
    expect(sides[9]).toEqual({ kind: 'blank', folio: 8 })
  })

  it.each([0, 1, 4, 5, 8, 13])('always makes a multiple of four for %i pages', (n) => {
    const sides = bookSides(n)
    expect(sides.length % 4).toBe(0)
    expect(sides.filter((s) => s.kind === 'page')).toHaveLength(n)
  })

  it('puts odd page numbers on right-hand pages', () => {
    bookSides(5).forEach((side, i) => {
      if (side.kind === 'page' || side.kind === 'blank') expect(isRecto(i)).toBe(side.folio % 2 === 1)
    })
  })
})

describe('bookSpreads', () => {
  it('shows the covers alone and the pages in facing pairs', () => {
    expect(bookSpreads(8)).toEqual([[0], [1, 2], [3, 4], [5, 6], [7]])
    expect(bookSpreads(4)).toEqual([[0], [1, 2], [3]])
  })
})

describe('bookletSheets', () => {
  it('puts the covers on the outside of the first sheet', () => {
    expect(bookletSheets(4)).toEqual([
      [3, 0],
      [1, 2],
    ])
  })

  it('uses every side once, with facing sides adding up like a folded stack', () => {
    const faces = bookletSheets(12)
    expect(faces).toHaveLength(6)
    expect(faces.flat().sort((a, b) => a - b)).toEqual([...Array(12).keys()])
    // Folded in half, the two sides on a face always add up to the last index.
    for (const [left, right] of faces) expect(left + right).toBe(11)
    expect(faces[0]).toEqual([11, 0])
    expect(faces[1]).toEqual([1, 10])
    expect(faces[5]).toEqual([5, 6])
  })

  it('refuses an incomplete booklet', () => {
    expect(() => bookletSheets(6)).toThrow()
  })
})

describe('hasLegacyGuide', () => {
  const { width, height } = GUIDE_BOX
  const blank = () => new Uint8ClampedArray(width * height * 4).fill(255)

  it('sees only a rule along the baseline as no guide', () => {
    const pixels = blank()
    const row = LEGACY_BASELINE - GUIDE_BOX.y
    for (let y = row - 1; y <= row + 1; y++) {
      for (let x = 0; x < width; x++) pixels.set([138, 131, 152, 255], (y * width + x) * 4)
    }
    expect(hasLegacyGuide(pixels, width, height)).toBe(false)
  })

  it('sees a sticker as a guide', () => {
    const pixels = blank()
    for (let y = 20; y < height - 20; y++) {
      for (let x = 40; x < width - 40; x++) pixels.set([255, 120, 0, 255], (y * width + x) * 4)
    }
    expect(hasLegacyGuide(pixels, width, height)).toBe(true)
  })
})
