import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { LEGACY_BOOK_ID, type CoverBackground, type CoverLayout } from './books'
import type { ColoringDetail } from './coloring'
import type { FolderColor, FolderKey } from './folders'
import type { StickerEffect } from './effects'
import type { StickerAnalysis, TopicId } from './topics'

export interface StickerRecord {
  id: string
  blob: Blob
  width: number
  height: number
  createdAt: number
  /** What the sticker shows, filled in in the background after saving. */
  analysis?: StickerAnalysis
  /** Topic the user picked by hand, overriding the automatic one. */
  topic?: TopicId
  /**
   * Foil finish. Optional and unindexed, so no schema upgrade is needed: stickers saved before
   * effects existed simply don't have it, and read as 'none' (see effectOf).
   */
  effect?: StickerEffect
}

/** How the user dressed up a folder in the collection. */
export interface FolderRecord {
  key: FolderKey
  color: FolderColor
}

/** A coloring book: its title and how its cover looks. Its pages point at it. */
export interface BookRecord {
  id: string
  title: string
  background: CoverBackground
  layout: CoverLayout
  createdAt: number
}

/** A page in a coloring book. */
export interface BookPageRecord {
  id: string
  /** The book it's in. Pages from before there could be several books don't have one (see bookIdOf). */
  bookId?: string
  stickerId: string
  /** A copy of the original sticker for the cover, so the book survives the sticker being deleted. */
  sticker: Blob
  effect?: StickerEffect
  /** The A5 page as a PNG at print resolution; page numbers and running heads are added when printing. */
  page: Blob
  detail: ColoringDetail
  /** Order in the book; lower comes first. */
  position: number
  createdAt: number
}

export const bookIdOf = (page: Pick<BookPageRecord, 'bookId'>) => page.bookId ?? LEGACY_BOOK_ID

/**
 * What changed on this device and still has to be sent to the server. One entry per record.
 * 'book' is a page of a coloring book (from when there was only one), 'book-info' a book itself.
 */
export type OutboxKind = 'sticker' | 'folder' | 'book' | 'book-info' | 'settings'

export interface OutboxEntry {
  key: string
  kind: OutboxKind
  id: string
  /** The record's pictures haven't been uploaded yet. */
  images: boolean
  /** Changes on every edit, so an upload only clears the entry if nothing changed in between. */
  seq: number
}

interface StickerDB extends DBSchema {
  stickers: {
    key: string
    value: StickerRecord
    indexes: { createdAt: number }
  }
  folders: {
    key: string
    value: FolderRecord
  }
  book: {
    key: string
    value: BookPageRecord
  }
  books: {
    key: string
    value: BookRecord
  }
  outbox: {
    key: string
    value: OutboxEntry
  }
  meta: {
    key: string
    value: { key: string; value: unknown }
  }
}

let dbPromise: Promise<IDBPDatabase<StickerDB>> | undefined

function db() {
  // Each step only adds to what the previous version had, so existing collections are kept.
  dbPromise ??= openDB<StickerDB>('stickers', 5, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore('stickers', { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
      if (oldVersion < 2) database.createObjectStore('folders', { keyPath: 'key' })
      if (oldVersion < 3) database.createObjectStore('book', { keyPath: 'id' })
      if (oldVersion < 4) {
        database.createObjectStore('outbox', { keyPath: 'key' })
        database.createObjectStore('meta', { keyPath: 'key' })
      }
      if (oldVersion < 5) database.createObjectStore('books', { keyPath: 'id' })
    },
    // Another tab with a newer version wants to upgrade: step aside and reopen on next use.
    blocking(_current, _blocked, event) {
      ;(event.target as IDBDatabase).close()
      dbPromise = undefined
    },
  })
  return dbPromise
}

/**
 * Tells the sync engine about local edits ('local'), and the screens about records that arrived
 * from another device ('remote').
 */
export const collectionEvents = new EventTarget()

let lastSeq = 0
/** Increasing even when called twice in the same millisecond. */
const nextSeq = () => (lastSeq = Math.max(lastSeq + 1, Date.now()))

type Outbox = { get(key: string): Promise<OutboxEntry | undefined>; put(value: OutboxEntry): Promise<unknown> }

/** Notes in the outbox that a record changed, inside the caller's transaction. */
async function enqueue(outbox: Outbox, kind: OutboxKind, id: string, images = false) {
  const key = `${kind}:${id}`
  const pending = await outbox.get(key)
  await outbox.put({ key, kind, id, images: images || !!pending?.images, seq: nextSeq() })
}

const changedLocally = () => collectionEvents.dispatchEvent(new Event('local'))

/** All stickers, newest first. */
export async function listStickers(): Promise<StickerRecord[]> {
  const all = await (await db()).getAllFromIndex('stickers', 'createdAt')
  return all.reverse()
}

export async function getSticker(id: string): Promise<StickerRecord | undefined> {
  return (await db()).get('stickers', id)
}

export async function saveSticker(record: StickerRecord): Promise<void> {
  const tx = (await db()).transaction(['stickers', 'outbox'], 'readwrite')
  await Promise.all([tx.objectStore('stickers').put(record), enqueue(tx.objectStore('outbox'), 'sticker', record.id, true)])
  await tx.done
  changedLocally()
}

/** Applies `patch` to a saved sticker. Does nothing if it was deleted in the meantime. */
export async function updateSticker(id: string, patch: Partial<Omit<StickerRecord, 'id' | 'blob'>>): Promise<void> {
  const tx = (await db()).transaction(['stickers', 'outbox'], 'readwrite')
  const store = tx.objectStore('stickers')
  const record = await store.get(id)
  if (record) await Promise.all([store.put({ ...record, ...patch }), enqueue(tx.objectStore('outbox'), 'sticker', id)])
  await tx.done
  if (record) changedLocally()
}

export async function deleteSticker(id: string): Promise<void> {
  const tx = (await db()).transaction(['stickers', 'outbox'], 'readwrite')
  await Promise.all([tx.objectStore('stickers').delete(id), enqueue(tx.objectStore('outbox'), 'sticker', id)])
  await tx.done
  changedLocally()
}

export async function listFolders(): Promise<FolderRecord[]> {
  return (await db()).getAll('folders')
}

export async function getFolder(key: string): Promise<FolderRecord | undefined> {
  return (await db()).get('folders', key)
}

export async function saveFolder(record: FolderRecord): Promise<void> {
  const tx = (await db()).transaction(['folders', 'outbox'], 'readwrite')
  await Promise.all([tx.objectStore('folders').put(record), enqueue(tx.objectStore('outbox'), 'folder', record.key)])
  await tx.done
  changedLocally()
}

/** Every coloring book, oldest first. */
export async function listBooks(): Promise<BookRecord[]> {
  const all = await (await db()).getAll('books')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  return (await db()).get('books', id)
}

export async function saveBook(record: BookRecord): Promise<void> {
  const tx = (await db()).transaction(['books', 'outbox'], 'readwrite')
  await Promise.all([tx.objectStore('books').put(record), enqueue(tx.objectStore('outbox'), 'book-info', record.id)])
  await tx.done
  changedLocally()
}

/** Deletes a book and every page in it. */
export async function deleteBook(id: string): Promise<void> {
  const tx = (await db()).transaction(['books', 'book', 'outbox'], 'readwrite')
  const outbox = tx.objectStore('outbox')
  const pages = (await tx.objectStore('book').getAll()).filter((p) => bookIdOf(p) === id)
  await tx.objectStore('books').delete(id)
  await enqueue(outbox, 'book-info', id)
  for (const page of pages) await Promise.all([tx.objectStore('book').delete(page.id), enqueue(outbox, 'book', page.id)])
  await tx.done
  changedLocally()
}

/** The pages of every coloring book, each book's in order. */
export async function listBookPages(): Promise<BookPageRecord[]> {
  const all = await (await db()).getAll('book')
  return all.sort((a, b) => a.position - b.position)
}

export async function getBookPage(id: string): Promise<BookPageRecord | undefined> {
  return (await db()).get('book', id)
}

export async function saveBookPage(record: BookPageRecord): Promise<void> {
  const tx = (await db()).transaction(['book', 'outbox'], 'readwrite')
  await Promise.all([tx.objectStore('book').put(record), enqueue(tx.objectStore('outbox'), 'book', record.id, true)])
  await tx.done
  changedLocally()
}

export async function deleteBookPage(id: string): Promise<void> {
  const tx = (await db()).transaction(['book', 'outbox'], 'readwrite')
  await Promise.all([tx.objectStore('book').delete(id), enqueue(tx.objectStore('outbox'), 'book', id)])
  await tx.done
  changedLocally()
}

/** Renumbers a book so its pages come in the order of `ids`. */
export async function reorderBook(ids: string[]): Promise<void> {
  const tx = (await db()).transaction(['book', 'outbox'], 'readwrite')
  const store = tx.objectStore('book')
  await Promise.all(
    ids.map(async (id, position) => {
      const record = await store.get(id)
      if (record && record.position !== position) {
        await Promise.all([store.put({ ...record, position }), enqueue(tx.objectStore('outbox'), 'book', id)])
      }
    }),
  )
  await tx.done
  changedLocally()
}

/** Records that the book title changed (the title itself lives in localStorage). */
export async function bookTitleChanged(): Promise<void> {
  const tx = (await db()).transaction('outbox', 'readwrite')
  await enqueue(tx.store, 'settings', 'book')
  await tx.done
  changedLocally()
}

/** Everything in the database, for backups. */
export async function readAll() {
  const database = await db()
  const [stickers, folders, book, books] = await Promise.all([
    listStickers(),
    database.getAll('folders'),
    listBookPages(),
    listBooks(),
  ])
  return { stickers, folders, book, books }
}

/**
 * Adds restored records to the collection in one go. Records with the same id are replaced, and
 * anything not in the backup is left alone, so restoring twice or onto a used phone is safe.
 */
export async function restoreAll(data: {
  stickers: StickerRecord[]
  folders: FolderRecord[]
  book: BookPageRecord[]
  books: BookRecord[]
}) {
  const tx = (await db()).transaction(['stickers', 'folders', 'book', 'books', 'outbox'], 'readwrite')
  const outbox = tx.objectStore('outbox')
  // One at a time per store: enqueue reads before it writes, so parallel calls for one key could race.
  for (const r of data.stickers) await Promise.all([tx.objectStore('stickers').put(r), enqueue(outbox, 'sticker', r.id, true)])
  for (const r of data.folders) await Promise.all([tx.objectStore('folders').put(r), enqueue(outbox, 'folder', r.key)])
  for (const r of data.book) await Promise.all([tx.objectStore('book').put(r), enqueue(outbox, 'book', r.id, true)])
  for (const r of data.books) await Promise.all([tx.objectStore('books').put(r), enqueue(outbox, 'book-info', r.id)])
  await tx.done
  changedLocally()
}

// Sync bookkeeping.

export async function listOutbox(): Promise<OutboxEntry[]> {
  const all = await (await db()).getAll('outbox')
  return all.sort((a, b) => a.seq - b.seq)
}

/** Clears entries that were sent, unless they changed again while sending. */
export async function clearOutbox(sent: OutboxEntry[]) {
  const tx = (await db()).transaction('outbox', 'readwrite')
  await Promise.all(
    sent.map(async (entry) => {
      if ((await tx.store.get(entry.key))?.seq === entry.seq) await tx.store.delete(entry.key)
    }),
  )
  await tx.done
}

/**
 * Queues the whole collection for upload, e.g. the first time this device signs in. The book title
 * only goes if this device has one, so a new device doesn't blank the title everywhere else.
 */
export async function queueEverything({ bookTitle }: { bookTitle: boolean }) {
  const tx = (await db()).transaction(['stickers', 'folders', 'book', 'books', 'outbox'], 'readwrite')
  const outbox = tx.objectStore('outbox')
  const [stickers, folders, book, books] = await Promise.all([
    tx.objectStore('stickers').getAllKeys(),
    tx.objectStore('folders').getAllKeys(),
    tx.objectStore('book').getAllKeys(),
    tx.objectStore('books').getAllKeys(),
  ])
  for (const id of stickers) await enqueue(outbox, 'sticker', id, true)
  for (const key of folders) await enqueue(outbox, 'folder', key)
  for (const id of books) await enqueue(outbox, 'book-info', id)
  for (const id of book) await enqueue(outbox, 'book', id, true)
  if (bookTitle) await enqueue(outbox, 'settings', 'book')
  await tx.done
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await (await db()).put('meta', { key, value })
}

/** A change from the server. New records arrive with their pictures; updates to known ones don't need them. */
export type RemoteChange<T> = { deleted: true; key: string } | { deleted?: false; key: string; record: T }

/**
 * Saves changes that came from another device, without queueing them to be sent back. Records
 * with unsent local edits are left alone: the local edit goes up next and wins.
 */
export async function applyRemote(changes: {
  stickers: RemoteChange<Omit<StickerRecord, 'blob'> & { blob?: Blob }>[]
  folders: FolderRecord[]
  book: RemoteChange<Omit<BookPageRecord, 'page' | 'sticker'> & { page?: Blob; sticker?: Blob }>[]
  books: RemoteChange<BookRecord>[]
}): Promise<boolean> {
  const tx = (await db()).transaction(['stickers', 'folders', 'book', 'books', 'outbox'], 'readwrite')
  const outbox = tx.objectStore('outbox')
  const pending = new Set(await outbox.getAllKeys())
  let changed = false

  for (const change of changes.stickers) {
    if (pending.has(`sticker:${change.key}`)) continue
    const store = tx.objectStore('stickers')
    const current = await store.get(change.key)
    if (change.deleted) {
      if (current) await store.delete(change.key)
    } else {
      const blob = change.record.blob ?? current?.blob
      if (!blob) continue
      await store.put({ ...change.record, blob })
    }
    changed = true
  }
  for (const record of changes.folders) {
    if (pending.has(`folder:${record.key}`)) continue
    await tx.objectStore('folders').put(record)
    changed = true
  }
  for (const change of changes.book) {
    if (pending.has(`book:${change.key}`)) continue
    const store = tx.objectStore('book')
    const current = await store.get(change.key)
    if (change.deleted) {
      if (current) await store.delete(change.key)
    } else {
      const page = change.record.page ?? current?.page
      const sticker = change.record.sticker ?? current?.sticker
      if (!page || !sticker) continue
      await store.put({ ...change.record, page, sticker })
    }
    changed = true
  }
  for (const change of changes.books) {
    if (pending.has(`book-info:${change.key}`)) continue
    const store = tx.objectStore('books')
    if (change.deleted) await store.delete(change.key)
    else await store.put(change.record)
    changed = true
  }
  await tx.done
  if (changed) collectionEvents.dispatchEvent(new Event('remote'))
  return changed
}

/** Whether a settings change is waiting to be sent, so a pulled one shouldn't overwrite it. */
export async function hasPending(kind: OutboxKind, id: string) {
  return !!(await (await db()).get('outbox', `${kind}:${id}`))
}

export function newId(): string {
  // randomUUID only exists in secure contexts; plain-http LAN testing still needs ids.
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Asks the browser not to evict the collection under storage pressure. Best effort. */
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {})
}
