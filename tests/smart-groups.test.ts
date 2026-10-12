import { describe, expect, it } from 'vitest'
import {
  aiFolderLabels,
  aiKey,
  assignGroups,
  cleanDescription,
  cleanGrouping,
  folderBudget,
  groupPrompt,
  groupRequest,
  needsDescription,
  needsFolder,
  parseStickerAi,
  type Groupable,
  type StickerAi,
} from '../src/lib/smart-groups'
import { groupByTopic } from '../src/lib/topics'

const ai = (subject: string, folder?: StickerAi['folder'], extra: Partial<StickerAi> = {}): StickerAi => ({
  version: 1,
  subject,
  series: '',
  tags: ['cartoon'],
  topic: 'cartoons',
  ...(folder && { folder }),
  ...extra,
})

describe('aiKey', () => {
  it('ignores case, accents and punctuation', () => {
    expect(aiKey('Pokémon')).toBe('ai:pokemon')
    expect(aiKey('  Star Wars! ')).toBe('ai:star-wars')
    expect(aiKey('Cute animals')).toBe(aiKey('cute  ANIMALS'))
    expect(aiKey('🎉')).toBe('ai:folder')
  })
})

describe('cleanDescription', () => {
  it('trims, dedupes and caps what the model said', () => {
    expect(cleanDescription({ subject: '  A   frog ', series: 7, tags: ['Green', 'green', '', 'cute', 'a', 'b', 'c', 'd'], topic: 'animals' })).toEqual({
      version: 1,
      subject: 'A frog',
      series: '',
      tags: ['green', 'cute', 'a', 'b', 'c', 'd'],
      topic: 'animals',
    })
    expect(cleanDescription({ subject: 'x', tags: 'no', topic: 'made-up' }).topic).toBe('other')
    expect(() => cleanDescription({ subject: '' })).toThrow()
  })
})

describe('parseStickerAi', () => {
  it('keeps a valid folder and drops junk', () => {
    expect(parseStickerAi({ ...ai('Bluey'), folder: { name: 'Bluey', emoji: '🐶', pinned: true } })?.folder).toEqual({
      name: 'Bluey',
      emoji: '🐶',
      pinned: true,
    })
    expect(parseStickerAi({ ...ai('Bluey'), folder: { name: '' } })?.folder).toBeUndefined()
    expect(parseStickerAi(null)).toBeUndefined()
    expect(parseStickerAi({ subject: '' })).toBeUndefined()
  })
})

describe('assignGroups', () => {
  const stickers: Groupable[] = [
    { id: 'hand', topic: 'food', ai: ai('Bluey', { name: 'Bluey', emoji: '🐶' }) },
    { id: 'folder', ai: ai('Bingo', { name: 'Bluey', emoji: '🐶' }) },
    { id: 'described', ai: ai('A cake', undefined, { topic: 'food' }) },
    { id: 'new' },
  ]

  it('prefers a pick by hand, then the AI folder, then a topic', () => {
    const groups = assignGroups(stickers)
    expect(groups.get('hand')).toBe('food')
    expect(groups.get('folder')).toBe('ai:bluey')
    expect(groups.get('described')).toBe('food')
    expect(groups.get('new')).toBeUndefined()
    expect(groupByTopic(stickers, groups).map((g) => g.key)).toEqual(['new', 'food', 'ai:bluey'])
  })

  it('leaves AI folders out when they are turned off', () => {
    expect(assignGroups(stickers, false).get('folder')).toBe('cartoons')
  })
})

describe('aiFolderLabels', () => {
  it('names each folder the way most of its stickers do', () => {
    const labels = aiFolderLabels([
      { id: 'a', ai: ai('x', { name: 'Pokemon', emoji: '⚡' }) },
      { id: 'b', ai: ai('y', { name: 'Pokémon', emoji: '⚡' }) },
      { id: 'c', ai: ai('z', { name: 'Pokémon', emoji: '⚡' }) },
    ])
    expect([...labels]).toEqual([['ai:pokemon', { name: 'Pokémon', emoji: '⚡' }]])
  })
})

describe('grouping requests', () => {
  const all: Groupable[] = [
    { id: 'a', ai: ai('Bluey', { name: 'Bluey', emoji: '🐶' }) },
    { id: 'b', ai: ai('Bingo', { name: 'Bluey', emoji: '🐶' }) },
    { id: 'c', ai: ai('Pizza') },
    { id: 'd' },
  ]

  it('sends the folders there are, with examples, and the stickers to place', () => {
    const request = groupRequest(all, all.filter(needsFolder))
    expect(request).toEqual({
      folders: [{ name: 'Bluey', emoji: '🐶', count: 2, examples: ['Bluey', 'Bingo'] }],
      stickers: [{ id: 'c', subject: 'Pizza', series: '', tags: ['cartoon'] }],
    })
    expect(groupPrompt(request, 4)).toContain('1. Pizza (cartoon)')
    expect(all.filter(needsDescription).map((s) => s.id)).toEqual(['d'])
  })

  it('reads back folders by sticker number and ignores numbers that are not there', () => {
    const request = groupRequest(all, [all[2]])
    expect(cleanGrouping({ folders: [{ name: 'Food', emoji: '🍕', stickers: [0, 1, 2] }] }, request)).toEqual({
      assignments: [{ id: 'c', name: 'Food', emoji: '🍕' }],
    })
    expect(() => cleanGrouping({}, request)).toThrow()
  })

  it('allows more folders for bigger collections, within reason', () => {
    expect(folderBudget(1)).toBe(3)
    expect(folderBudget(25)).toBe(8)
    expect(folderBudget(5000)).toBe(14)
  })
})
