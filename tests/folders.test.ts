import { describe, expect, it } from 'vitest'
import {
  defaultFolderColor,
  fanLayout,
  FOLDER_COLORS,
  folderColor,
  folderLabel,
  isFolderColor,
  PEEK,
  stickerCount,
  type FolderColor,
} from '../src/lib/folders'
import { TOPIC_IDS } from '../src/lib/topics'

describe('folder colours', () => {
  it('gives every folder a stable preset by default', () => {
    expect(defaultFolderColor('all')).toBe('pink')
    expect(defaultFolderColor('new')).toBe('black')
    for (const id of TOPIC_IDS) {
      expect(FOLDER_COLORS).toContain(defaultFolderColor(id))
      expect(defaultFolderColor(id)).toBe(defaultFolderColor(id))
    }
    // Not every topic folder looks the same.
    expect(new Set(TOPIC_IDS.map(defaultFolderColor)).size).toBeGreaterThan(2)
  })

  it('prefers the colour the user picked', () => {
    const saved = new Map<string, FolderColor>([['dogs', 'mint']])
    expect(folderColor('dogs', saved)).toBe('mint')
    expect(folderColor('cats', saved)).toBe(defaultFolderColor('cats'))
  })

  it('only accepts known presets', () => {
    expect(isFolderColor('gold')).toBe(true)
    expect(isFolderColor('chartreuse')).toBe(false)
    expect(isFolderColor(undefined)).toBe(false)
  })
})

describe('folderLabel', () => {
  it('names topics, the unsorted folder and the everything folder', () => {
    expect(folderLabel('dogs', false).name).toBe('Dogs')
    expect(folderLabel('new', true).name).toBe('Sorting…')
    expect(folderLabel('new', false).name).toBe('Not sorted yet')
    expect(folderLabel('all', false).name).toBe('All stickers')
  })
})

describe('fanLayout', () => {
  it('shows at most PEEK stickers, front one on top', () => {
    expect(fanLayout(0)).toEqual([])
    expect(fanLayout(10)).toHaveLength(PEEK)
    expect(fanLayout(2).map((p) => p.z)).toEqual([2, 1])
  })

  it('slides stickers up and out to the right, fanning them', () => {
    const layout = fanLayout(3)
    for (const { rest, open } of layout) expect(open.y).toBeLessThan(rest.y)
    // The front sticker travels furthest right.
    expect(layout[0].open.x - layout[0].rest.x).toBeGreaterThan(layout[2].open.x - layout[2].rest.x)
    expect(new Set(layout.map((p) => p.open.r)).size).toBe(3)
  })

  it('nudges a lone sticker toward the middle of the pocket', () => {
    expect(fanLayout(1)[0].rest.x).toBeGreaterThan(fanLayout(3)[0].rest.x)
  })
})

describe('stickerCount', () => {
  it('pluralises', () => {
    expect(stickerCount(1)).toBe('1 sticker')
    expect(stickerCount(4)).toBe('4 stickers')
  })
})
