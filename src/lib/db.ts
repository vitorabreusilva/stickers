import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface StickerRecord {
  id: string
  blob: Blob
  width: number
  height: number
  createdAt: number
}

interface StickerDB extends DBSchema {
  stickers: {
    key: string
    value: StickerRecord
    indexes: { createdAt: number }
  }
}

let dbPromise: Promise<IDBPDatabase<StickerDB>> | undefined

function db() {
  dbPromise ??= openDB<StickerDB>('stickers', 1, {
    upgrade(database) {
      const store = database.createObjectStore('stickers', { keyPath: 'id' })
      store.createIndex('createdAt', 'createdAt')
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

export async function deleteSticker(id: string): Promise<void> {
  await (await db()).delete('stickers', id)
}

export function newId(): string {
  // randomUUID only exists in secure contexts; plain-http LAN testing still needs ids.
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Asks the browser not to evict the collection under storage pressure. Best effort. */
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {})
}
