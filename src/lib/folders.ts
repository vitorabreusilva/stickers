// Folders in the collection: one per topic group, plus "All stickers". Pure functions, no DOM.
import { groupLabel } from './smart-groups'
import type { TopicGroup } from './topics'

/** A folder: a topic group, 'new' for stickers still being sorted, or 'all' for everything. */
export type FolderKey = 'all' | TopicGroup<unknown>['key']

export const FOLDER_COLORS = ['gold', 'pink', 'black', 'sky', 'mint'] as const
export type FolderColor = (typeof FOLDER_COLORS)[number]

export const FOLDER_COLOR_NAMES: Record<FolderColor, string> = {
  gold: 'Gold',
  pink: 'Pink',
  black: 'Black',
  sky: 'Sky',
  mint: 'Mint',
}

export function isFolderColor(value: unknown): value is FolderColor {
  return typeof value === 'string' && (FOLDER_COLORS as readonly string[]).includes(value)
}

/** The colour a folder gets until the user picks one: stable per folder, varied across them. */
export function defaultFolderColor(key: FolderKey): FolderColor {
  if (key === 'all') return 'pink'
  if (key === 'new') return 'black'
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return FOLDER_COLORS[Math.abs(hash) % FOLDER_COLORS.length]
}

export function folderColor(key: FolderKey, saved: ReadonlyMap<string, FolderColor>): FolderColor {
  return saved.get(key) ?? defaultFolderColor(key)
}

/** Longest name a folder can be given. */
export const MAX_FOLDER_NAME = 40

/** `labels` names the AI folders (see aiFolderLabels); `names` are the ones the user gave folders. */
export function folderLabel(
  key: FolderKey,
  sorting: boolean,
  labels: ReadonlyMap<string, { name: string; emoji: string }> = new Map(),
  names: ReadonlyMap<string, string> = new Map(),
): { emoji: string; name: string } {
  if (key === 'new') return { emoji: '⏳', name: sorting ? 'Sorting…' : 'Not sorted yet' }
  const label = key === 'all' ? { emoji: '🗂️', name: 'All stickers' } : groupLabel(key, labels)
  const name = names.get(key)
  return name ? { ...label, name } : label
}

/** A name typed for a folder, tidied; '' means "go back to the automatic name". */
export function cleanFolderName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME)
}

/** How many stickers peek out of a folder. */
export const PEEK = 3

/** Where a peeking sticker sits: offsets in % of its own size, rotation in degrees. */
export interface Pose {
  x: number
  y: number
  r: number
}

// Index 0 is the front (newest) sticker. Tucked in, they overlap like stamps in a pocket; pulled
// out, they slide right and up and fan, the front one travelling furthest.
const REST: Pose[] = [
  { x: 0, y: 6, r: -4 },
  { x: 26, y: 0, r: 5 },
  { x: 52, y: 4, r: -7 },
]
const OPEN: Pose[] = [
  { x: 78, y: -30, r: 11 },
  { x: 40, y: -40, r: 2 },
  { x: 4, y: -36, r: -8 },
]

/**
 * Rest and pulled-out poses for the `count` stickers peeking out of a folder (at most PEEK), with
 * the order they stack in (front sticker on top) and stagger order for the slide.
 */
export function fanLayout(count: number): { rest: Pose; open: Pose; z: number }[] {
  const n = Math.max(0, Math.min(PEEK, Math.floor(count)))
  // Fewer stickers sit a little further right so the pocket doesn't look lopsided.
  const shift = (PEEK - n) * 13
  return Array.from({ length: n }, (_, i) => ({
    rest: { ...REST[i], x: REST[i].x + shift },
    open: OPEN[i],
    z: n - i,
  }))
}

export function stickerCount(n: number): string {
  return `${n} ${n === 1 ? 'sticker' : 'stickers'}`
}
