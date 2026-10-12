import type { BookPageRecord, FolderRecord, StickerRecord } from './db'

/**
 * A whole collection in one JSON file: stickers, folder colours and the coloring book, with every
 * picture inlined as base64. Meant for moving a collection between devices or into an account, so
 * it favours being one plain file over being small.
 */
export interface BackupContents {
  stickers: StickerRecord[]
  folders: FolderRecord[]
  book: BookPageRecord[]
  /** The coloring book's title, kept in localStorage rather than IndexedDB. */
  bookTitle: string | null
}

export const BACKUP_FORMAT = 'stickers-backup'
export const BACKUP_VERSION = 1

interface EncodedBlob {
  type: string
  base64: string
}

type Encoded<T> = { [K in keyof T]: T[K] extends Blob ? EncodedBlob : T[K] }

interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  stickers: Encoded<StickerRecord>[]
  folders: FolderRecord[]
  book: Encoded<BookPageRecord>[]
  bookTitle: string | null
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // fromCharCode takes its arguments on the stack, so feed it in chunks.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function encodeBlob(blob: Blob): Promise<EncodedBlob> {
  return { type: blob.type, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) }
}

function decodeBlob(value: unknown, what: string): Blob {
  const encoded = value as EncodedBlob
  if (typeof encoded?.base64 !== 'string') throw new BackupError(`A picture is missing from ${what}`)
  return new Blob([base64ToBytes(encoded.base64)], { type: encoded.type || 'image/png' })
}

export class BackupError extends Error {}

/**
 * Serialises a collection. Records are encoded one at a time and handed to the Blob as separate
 * parts, so a large collection never has to exist as a single giant string.
 */
export async function createBackup(contents: BackupContents, now = new Date()): Promise<Blob> {
  const parts: string[] = []
  const head: Omit<BackupFile, 'stickers' | 'book'> = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    folders: contents.folders,
    bookTitle: contents.bookTitle,
  }
  parts.push(JSON.stringify(head).slice(0, -1), ',"stickers":[')
  for (const [i, sticker] of contents.stickers.entries()) {
    parts.push(i ? ',' : '', JSON.stringify({ ...sticker, blob: await encodeBlob(sticker.blob) }))
  }
  parts.push('],"book":[')
  for (const [i, page] of contents.book.entries()) {
    parts.push(
      i ? ',' : '',
      JSON.stringify({ ...page, sticker: await encodeBlob(page.sticker), page: await encodeBlob(page.page) }),
    )
  }
  parts.push(']}')
  return new Blob(parts, { type: 'application/json' })
}

/** Reads a backup file back into records. Throws BackupError when it isn't one. */
export async function readBackup(file: Blob): Promise<BackupContents> {
  let data: BackupFile
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new BackupError("That file isn't a Stickers backup")
  }
  if (data?.format !== BACKUP_FORMAT) throw new BackupError("That file isn't a Stickers backup")
  if (data.version > BACKUP_VERSION) throw new BackupError('That backup is from a newer version of the app')

  const stickers = (data.stickers ?? []).map((s) => {
    if (typeof s.id !== 'string') throw new BackupError('The backup has a broken sticker')
    return { ...s, blob: decodeBlob(s.blob, 'a sticker') } as StickerRecord
  })
  const book = (data.book ?? []).map((p) => {
    if (typeof p.id !== 'string') throw new BackupError('The backup has a broken coloring page')
    return {
      ...p,
      sticker: decodeBlob(p.sticker, 'a coloring page'),
      page: decodeBlob(p.page, 'a coloring page'),
    } as BookPageRecord
  })
  return {
    stickers,
    folders: (data.folders ?? []).filter((f) => typeof f?.key === 'string'),
    book,
    bookTitle: typeof data.bookTitle === 'string' ? data.bookTitle : null,
  }
}

export function backupFilename(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `stickers-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}
