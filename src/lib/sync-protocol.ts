// What the app and the server send each other when syncing. Shared by both sides, so it must stay
// free of browser- and server-only imports.

import type { EncodedAnalysis } from './codec'

/** Pictures are uploaded on their own, before the records that point at them. */
export type ImageKind = 'sticker' | 'book-page' | 'book-sticker'
export const IMAGE_KINDS: readonly ImageKind[] = ['sticker', 'book-page', 'book-sticker']
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
}

export interface SyncFolder {
  key: string
  color: string
}

export interface SyncBookPage {
  id: string
  deleted?: boolean
  stickerId: string
  effect?: string | null
  detail: string
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
  settings?: SyncSettings
}

export interface AccountInfo {
  name: string
  email: string
  image: string | null
}
