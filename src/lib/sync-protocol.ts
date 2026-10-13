// What the app and the server send each other when syncing. Shared by both sides, so it must stay
// free of browser- and server-only imports.

import type { EncodedAnalysis } from './codec'

/** Pictures are uploaded on their own, before the records that point at them. */
export type ImageKind = 'sticker' | 'sticker-source' | 'book-page' | 'book-sticker'
export const IMAGE_KINDS: readonly ImageKind[] = ['sticker', 'sticker-source', 'book-page', 'book-sticker']
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
/** Vercel Functions take request bodies up to 4.5 MB. */
export const MAX_IMAGE_BYTES = 4_000_000

export const isRecordId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,64}$/.test(id)

export interface SyncSticker {
  id: string
  deleted?: boolean
  width: number
  height: number
  createdAt: number
  analysis?: EncodedAnalysis | null
  topic?: string | null
  effect?: string | null
  /** What the AI says it shows, and its AI folder (see smart-groups). Missing from devices that haven't updated. */
  ai?: object | null
  /**
   * Where the sticker sits in the picture it was cut from, which is uploaded as 'sticker-source'.
   * null when there's no such picture; missing from devices that haven't updated.
   */
  sourceRect?: { x: number; y: number; width: number; height: number } | null
}

export interface SyncFolder {
  key: string
  /** '' until a colour is picked. */
  color: string
  /** The name the user gave it; '' or null for none. Missing from devices that haven't updated. */
  name?: string | null
}

export interface SyncBook {
  id: string
  deleted?: boolean
  title: string
  background: string
  layout: string
  /** One sticker on the cover instead of the layout (see BookCover). Missing from devices that haven't updated. */
  cover?: object | null
  createdAt: number
}

export interface SyncBookPage {
  id: string
  deleted?: boolean
  /** Missing from devices that haven't updated; those pages are in the first book. */
  bookId?: string
  stickerId: string
  effect?: string | null
  detail: string
  /** The colour guide in the corner is hidden. Missing from devices that haven't updated. */
  hideGuide?: boolean
  position: number
  createdAt: number
}

export interface SyncSettings {
  bookTitle: string | null
}

/** Changes from a device. A record with `deleted` only needs its id. */
export interface SyncPush {
  stickers?: SyncSticker[]
  folders?: SyncFolder[]
  book?: SyncBookPage[]
  books?: SyncBook[]
  settings?: SyncSettings
}

export const MAX_PUSH_RECORDS = 500

/** Everything that changed after `since`, oldest first. Ask again from `rev` while `more` is true. */
export interface SyncPull {
  rev: number
  more: boolean
  stickers: SyncSticker[]
  folders: SyncFolder[]
  book: SyncBookPage[]
  books: SyncBook[]
  settings?: SyncSettings
}

export interface AccountInfo {
  name: string
  email: string
  image: string | null
}
