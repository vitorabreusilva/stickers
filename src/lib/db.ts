import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { FolderColor, FolderKey } from './folders'
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
}

/** How the user dressed up a folder in the collection. */
export interface FolderRecord {
  key: FolderKey
  color: FolderColor
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
}

let dbPromise: Promise<IDBPDatabase<StickerDB>> | undefined

function db() {
  // Each step only adds to what the previous version had, so existing collections are kept.
  dbPromise ??= openDB<StickerDB>('stickers', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore('stickers', { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
      if (oldVersion < 2) database.createObjectStore('folders', { keyPath: 'key' })
    },
    // Another tab with a newer version wants to upgrade: step aside and reopen on next use.
    blocking(_current, _blocked, event) {
      ;(event.target as IDBDatabase).close()
      dbPromise = undefined
    },
  })
  return dbPromise
}

/** All stickers, newest first. */
export async function listStickers(): Promise<StickerRecord[]> {
  const all = await (await db()).getAllFromIndex('stickers', 'createdAt')
  return all.reverse()
}

export async function saveSticker(record: StickerRecord): Promise<void> {
  await (await db()).put('stickers', record)
}

/** Applies `patch` to a saved sticker. Does nothing if it was deleted in the meantime. */
export async function updateSticker(id: string, patch: Partial<Omit<StickerRecord, 'id' | 'blob'>>): Promise<void> {
  const tx = (await db()).transaction('stickers', 'readwrite')
  const record = await tx.store.get(id)
  if (record) await tx.store.put({ ...record, ...patch })
  await tx.done
}

export async function deleteSticker(id: string): Promise<void> {
  await (await db()).delete('stickers', id)
}

export async function listFolders(): Promise<FolderRecord[]> {
  return (await db()).getAll('folders')
}

export async function saveFolder(record: FolderRecord): Promise<void> {
  await (await db()).put('folders', record)
}

export function newId(): string {
  // randomUUID only exists in secure contexts; plain-http LAN testing still needs ids.
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Asks the browser not to evict the collection under storage pressure. Best effort. */
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {})
}
