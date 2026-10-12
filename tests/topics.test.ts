import { describe, expect, it } from 'vitest'
import { assignTopics, groupByTopic, topicOfClass, topicScores, type StickerAnalysis } from '../src/lib/topics'

/** A unit vector along axis `i` (plus a little of `j`), standing in for a visual embedding. */
function look(i: number, j = i, mix = 0) {
  const v = new Float32Array(8)
  v[i] += 1 - mix
  v[j] += mix
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}

function analysis(classes: [number, string, number][], extra: Partial<StickerAnalysis> = {}): StickerAnalysis {
  return {
    version: 1,
    classes: classes.map(([index, name, score]) => ({ index, name, score })),
    face: 0,
    drawn: 0.1,
    embedding: look(0),
    ...extra,
  }
}

describe('topicOfClass', () => {
  it('maps ImageNet ranges and object names to topics', () => {
    expect(topicOfClass(263, 'Pembroke')).toBe('dogs')
    expect(topicOfClass(285, 'Egyptian cat')).toBe('cats')
    expect(topicOfClass(1, 'goldfish')).toBe('animals')
    expect(topicOfClass(933, 'cheeseburger')).toBe('food')
    expect(topicOfClass(982, 'groom')).toBe('people')
    expect(topicOfClass(805, 'soccer ball')).toBe('sports')
    expect(topicOfClass(402, 'acoustic guitar')).toBe('music')
    expect(topicOfClass(917, 'comic book')).toBe('cartoons')
    expect(topicOfClass(559, 'folding chair')).toBe('stuff')
  })
})

describe('topicScores', () => {
  it('adds up class probabilities per topic', () => {
    const scores = topicScores(analysis([[263, 'Pembroke', 0.6], [264, 'Cardigan', 0.2], [285, 'Egyptian cat', 0.1]]))
    expect(scores.get('dogs')).toBeCloseTo(0.8)
    expect(scores.get('cats')).toBeCloseTo(0.1)
  })

  it('lets a clear face outweigh clothing', () => {
    const scores = topicScores(analysis([[834, 'suit', 0.7]], { face: 0.97 }))
    expect(scores.get('people')!).toBeGreaterThan(scores.get('fashion')!)
  })

  it('counts looking like a drawing as cartoon evidence', () => {
    expect(topicScores(analysis([], { drawn: 0.35 })).get('cartoons')).toBeGreaterThan(0.2)
    expect(topicScores(analysis([], { drawn: 0.1 })).has('cartoons')).toBe(false)
  })
})

describe('assignTopics', () => {
  it('picks the strongest topic, and Other when nothing is convincing', () => {
    const topics = assignTopics([
      { id: 'corgi', analysis: analysis([[263, 'Pembroke', 0.8]]) },
      { id: 'blob', analysis: analysis([[600, 'hook', 0.05]], { embedding: look(1) }) },
    ])
    expect(topics.get('corgi')).toBe('dogs')
    expect(topics.get('blob')).toBe('other')
  })

  it("doesn't let the catch-all win on many tiny scores", () => {
    const topics = assignTopics([
      {
        id: 'guitar',
        analysis: analysis([[402, 'acoustic guitar', 0.2], [731, 'plunger', 0.12], [792, 'shovel', 0.12]]),
      },
    ])
    expect(topics.get('guitar')).toBe('music')
  })

  it('pulls an unsure sticker toward the topic of stickers that look like it', () => {
    const cartoon = (id: string, mix: number, classes: [number, string, number][]) => ({
      id,
      analysis: analysis(classes, { embedding: look(2, 3, mix), drawn: 0.25 }),
    })
    const topics = assignTopics([
      cartoon('a', 0, [[917, 'comic book', 0.3]]),
      cartoon('b', 0.1, [[917, 'comic book', 0.25]]),
      // On its own this one looks like a clock.
      cartoon('c', 0.2, [[892, 'wall clock', 0.2]]),
    ])
    expect(topics.get('c')).toBe('cartoons')
  })

  it('respects topics picked by hand and leaves unanalysed stickers unsorted', () => {
    const topics = assignTopics([
      { id: 'moved', topic: 'food', analysis: analysis([[263, 'Pembroke', 0.9]]) },
      { id: 'new' },
    ])
    expect(topics.get('moved')).toBe('food')
    expect(topics.get('new')).toBeUndefined()
  })
})

describe('groupByTopic', () => {
  it('puts unsorted first, bigger groups next and Other last, keeping order inside groups', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }))
    const topics = new Map<string, Parameters<typeof assignTopics>[0][number]['topic']>([
      ['a', 'other'],
      ['b', 'dogs'],
      ['c', undefined],
      ['d', 'food'],
      ['e', 'dogs'],
      ['f', 'other'],
    ])
    const groups = groupByTopic(items, topics)
    expect(groups.map((g) => g.key)).toEqual(['new', 'dogs', 'food', 'other'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['b', 'e'])
  })
})
