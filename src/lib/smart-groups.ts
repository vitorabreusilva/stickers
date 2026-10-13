// AI folders: a vision model says what's in each sticker, then a language model sorts the
// collection into folders named after what this person actually collects ("Bluey", "Pokémon",
// "Taylor Swift"), rather than the fixed topics the on-device models pick from. Pure: shared by
// the app, the server and the tests.

import { assignTopics, TOPIC_IDS, TOPICS, type GroupKey, type Topicable, type TopicId } from './topics.js'

/** Bump when the description prompt changes enough that stickers should be described again. */
export const AI_LABEL_VERSION = 1

/** A folder the AI made, as stored on each sticker in it. */
export interface AiFolder {
  name: string
  emoji: string
  /** Put there by hand: regrouping leaves it where it is. */
  pinned?: boolean
}

/** What the AI says about a sticker, and the folder it put it in. Synced with the sticker. */
export interface StickerAi {
  version: number
  /** What it shows, as specifically as the model can tell: "Bluey", "Golden retriever puppy". */
  subject: string
  /** The show, game, band, team or brand it's from; '' when it isn't from one. */
  series: string
  tags: string[]
  /** The closest of the fixed topics, used until it's in a folder. */
  topic: TopicId
  folder?: AiFolder
}

const MAX_NAME = 40
const MAX_SUBJECT = 80
const MAX_TAGS = 6
/** A folder named after one show or character needs this many stickers to be worth it. */
export const MIN_SPECIFIC = 3
/** At most this many stickers go to the model in one grouping request. */
export const MAX_GROUP_BATCH = 150

/** The folder key for an AI folder: its name, lower-cased and without accents or punctuation. */
export function aiKey(name: string): `ai:${string}` {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `ai:${slug || 'folder'}`
}

export const isAiKey = (key: string): key is `ai:${string}` => key.startsWith('ai:')

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** The first emoji in `value`, or a fallback. */
function oneEmoji(value: unknown, fallback = '✨'): string {
  if (typeof value !== 'string') return fallback
  const match = value.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*/u)
  return match ? match[0] : fallback
}

// ——— Describing a sticker ———

export const DESCRIBE_PROMPT = `This picture is a sticker someone cut out of an image they found, for their sticker collection.
Say what it shows, so the collection can be sorted into folders.

- subject: what it is, as specifically as you can tell, in at most a few words. Name well-known characters, mascots, people, brands, landmarks, vehicles or breeds when you recognise them ("Bluey", "Pikachu", "Golden retriever puppy", "Eiffel Tower"). Otherwise describe it plainly ("Cartoon frog with a crown").
- series: the show, film, game, book, band, sports team or brand it comes from, if any ("Bluey", "Pokémon", "Star Wars"). Empty when it isn't from one.
- tags: 3 to 6 short lowercase words about it: what kind of thing it is, its style (cartoon, photo, drawing, pixel art), main colours and mood.
- topic: the closest of: ${TOPIC_IDS.join(', ')}. "cartoons" is for drawn or animated things that fit nothing more specific; "stuff" for everyday objects; "other" only when nothing fits.`

/** JSON schema for the description, in the subset both Gemini and OpenAI accept. */
export const DESCRIBE_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    series: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    topic: { type: 'string', enum: TOPIC_IDS },
  },
  required: ['subject', 'series', 'tags', 'topic'],
  additionalProperties: false,
} as const

/** The model's description, checked and trimmed. Throws if it isn't one. */
export function cleanDescription(raw: unknown): Omit<StickerAi, 'folder'> {
  const r = raw as Record<string, unknown> | null
  const subject = clip(r?.subject, MAX_SUBJECT)
  if (!subject) throw new Error('No subject in the description')
  const tags = Array.isArray(r?.tags) ? r.tags.map((t) => clip(t, 30).toLowerCase()).filter(Boolean) : []
  return {
    version: AI_LABEL_VERSION,
    subject,
    series: clip(r?.series, MAX_SUBJECT),
    tags: [...new Set(tags)].slice(0, MAX_TAGS),
    topic: TOPIC_IDS.includes(r?.topic as TopicId) ? (r!.topic as TopicId) : 'other',
  }
}

/** A synced or restored description, checked; undefined if it isn't one. */
export function parseStickerAi(raw: unknown): StickerAi | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  try {
    const ai: StickerAi = { ...cleanDescription(r), version: typeof r.version === 'number' ? r.version : 0 }
    const folder = r.folder as Record<string, unknown> | undefined
    const name = clip(folder?.name, MAX_NAME)
    if (name) ai.folder = { name, emoji: oneEmoji(folder!.emoji), ...(folder!.pinned === true && { pinned: true }) }
    return ai
  } catch {
    return undefined
  }
}

// ——— Sorting the collection into folders ———

export interface GroupRequest {
  /** Folders there are already, to reuse where they fit. */
  folders: { name: string; emoji: string; count: number; examples: string[] }[]
  /** Stickers to put in folders. */
  stickers: { id: string; subject: string; series: string; tags: string[] }[]
}

export interface GroupReply {
  /** Where each sticker goes, by id. Stickers the model left out aren't in it. */
  assignments: { id: string; name: string; emoji: string }[]
}

/** How many folders a collection of `total` stickers should have at most. */
export function folderBudget(total: number): number {
  return Math.max(3, Math.min(14, Math.round(Math.sqrt(total) * 1.6)))
}

export function groupPrompt(request: GroupRequest, total: number): string {
  const existing = request.folders.length
    ? request.folders
        .map((f) => `- ${f.emoji} ${f.name} (${f.count} stickers, e.g. ${f.examples.slice(0, 4).join('; ') || 'none listed'})`)
        .join('\n')
    : '(none yet)'
  const stickers = request.stickers
    .map((s, i) => `${i + 1}. ${s.subject}${s.series ? ` [${s.series}]` : ''} (${s.tags.join(', ')})`)
    .join('\n')
  return `You sort a person's sticker collection into folders. The collection has ${total} stickers.

Folders the collection already has:
${existing}

Stickers to put in folders, numbered:
${stickers}

Put every numbered sticker in exactly one folder.
- Name folders after what this person collects: a character, show, game, band, person, team or brand when several stickers share one ("Bluey", "Pokémon", "Taylor Swift"), otherwise a theme ("Dogs", "Food", "Cute animals", "Space").
- A folder named after one character, show or person needs at least ${MIN_SPECIFIC} stickers across the collection, counting the existing folder. Fewer go in a broader folder.
- When a sticker fits an existing folder, use that folder's exact name and emoji.
- Keep the whole collection to at most ${folderBudget(total)} folders, existing ones included. Fewer, fuller folders are better than many tiny ones.
- Names are 1 to 3 words in sentence case, keeping capitals for proper names. Give each folder one emoji that fits it.`
}

export const GROUP_SCHEMA = {
  type: 'object',
  properties: {
    folders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          emoji: { type: 'string' },
          stickers: { type: 'array', items: { type: 'integer' } },
        },
        required: ['name', 'emoji', 'stickers'],
        additionalProperties: false,
      },
    },
  },
  required: ['folders'],
  additionalProperties: false,
} as const

/** The model's folders, checked, as assignments by sticker id. A sticker named twice keeps its first folder. */
export function cleanGrouping(raw: unknown, request: GroupRequest): GroupReply {
  const folders = (raw as { folders?: unknown } | null)?.folders
  if (!Array.isArray(folders)) throw new Error('No folders in the reply')
  // Names that differ only in case or accents are the same folder; existing folders keep their spelling.
  const known = new Map(request.folders.map((f) => [aiKey(f.name), { name: f.name, emoji: f.emoji }]))
  const assignments: GroupReply['assignments'] = []
  const placed = new Set<number>()
  for (const folder of folders as Record<string, unknown>[]) {
    const name = clip(folder?.name, MAX_NAME)
    if (!name || !Array.isArray(folder.stickers)) continue
    const key = aiKey(name)
    let label = known.get(key)
    if (!label) known.set(key, (label = { name, emoji: oneEmoji(folder.emoji) }))
    for (const n of folder.stickers) {
      const index = typeof n === 'number' ? n - 1 : -1
      const sticker = request.stickers[index]
      if (!sticker || placed.has(index)) continue
      placed.add(index)
      assignments.push({ id: sticker.id, ...label })
    }
  }
  return { assignments }
}

// ——— Folders in the app ———

export interface Groupable extends Topicable {
  ai?: StickerAi
}

/**
 * The folder each sticker is in: a topic picked by hand, then its AI folder (unless `aiFolders` is
 * off), then the topic the on-device models (or failing those, the AI's description) suggest.
 * Undefined while unsorted.
 */
export function assignGroups(stickers: Groupable[], aiFolders = true): Map<string, GroupKey | undefined> {
  const topics = assignTopics(stickers)
  const result = new Map<string, GroupKey | undefined>()
  for (const s of stickers) {
    if (s.topic) result.set(s.id, s.topic)
    else if (aiFolders && s.ai?.folder) result.set(s.id, aiKey(s.ai.folder.name))
    else result.set(s.id, topics.get(s.id) ?? s.ai?.topic)
  }
  return result
}

/** Names and emoji of the AI folders, by key; the spelling most stickers in it have wins. */
export function aiFolderLabels(stickers: Groupable[]): Map<string, { name: string; emoji: string }> {
  const votes = new Map<string, Map<string, { name: string; emoji: string; n: number }>>()
  for (const s of stickers) {
    const folder = s.ai?.folder
    if (!folder) continue
    const key = aiKey(folder.name)
    let byName = votes.get(key)
    if (!byName) votes.set(key, (byName = new Map()))
    const spelling = `${folder.emoji} ${folder.name}`
    const vote = byName.get(spelling) ?? { name: folder.name, emoji: folder.emoji, n: 0 }
    vote.n++
    byName.set(spelling, vote)
  }
  return new Map(
    [...votes].map(([key, byName]) => {
      const { name, emoji } = [...byName.values()].sort((a, b) => b.n - a.n)[0]
      return [key, { name, emoji }]
    }),
  )
}

/** A folder's name and emoji, whether it's a fixed topic or an AI folder. */
export function groupLabel(key: GroupKey, labels: ReadonlyMap<string, { name: string; emoji: string }>) {
  if (isAiKey(key)) return labels.get(key) ?? { name: 'Folder', emoji: '✨' }
  return TOPICS[key]
}

/** `ai` without its folder. */
export function withoutFolder(ai: StickerAi): StickerAi {
  const { folder: _, ...rest } = ai
  return rest
}

/** Stickers the AI should describe: not described yet, or by an older prompt. */
export const needsDescription = (s: Groupable) => !s.ai || s.ai.version < AI_LABEL_VERSION

/** Stickers the AI should put in a folder: described, but in no folder and not placed by hand. */
export const needsFolder = (s: Groupable) => !!s.ai && !s.ai.folder && !s.topic

/** What to send to sort `stickers` into folders, along with the folders the rest of `all` are in. */
export function groupRequest(all: Groupable[], stickers: Groupable[]): GroupRequest {
  const counts = new Map<string, { name: string; emoji: string; count: number; examples: string[] }>()
  const moving = new Set(stickers.map((s) => s.id))
  for (const s of all) {
    const folder = s.ai?.folder
    if (!folder || moving.has(s.id)) continue
    const key = aiKey(folder.name)
    const entry = counts.get(key) ?? { name: folder.name, emoji: folder.emoji, count: 0, examples: [] }
    entry.count++
    if (entry.examples.length < 4) entry.examples.push(s.ai!.subject)
    counts.set(key, entry)
  }
  return {
    folders: [...counts.values()].sort((a, b) => b.count - a.count),
    stickers: stickers.flatMap((s) => (s.ai ? [{ id: s.id, subject: s.ai.subject, series: s.ai.series, tags: s.ai.tags }] : [])),
  }
}
