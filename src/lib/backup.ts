import { base64ToBytes, bytesToBase64, decodeAnalysis, encodeAnalysis, type EncodedAnalysis } from './codec'
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

type Encoded<T> = { [K in keyof T]: T[K] extends Blob ? EncodedBlob : K extends 'analysis' ? EncodedAnalysis : T[K] }

interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  stickers: Encoded<StickerRecord>[]
  folders: FolderRecord[]
  book: Encoded<BookPageRecord>[]
  bookTitle: string | null
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
    parts.push(
      i ? ',' : '',
      JSON.stringify({
        ...sticker,
        blob: await encodeBlob(sticker.blob),
        analysis: sticker.analysis && encodeAnalysis(sticker.analysis),
      }),
    )
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
    const sticker = { ...s, blob: decodeBlob(s.blob, 'a sticker'), analysis: decodeAnalysis(s.analysis) }
    if (!sticker.analysis) delete sticker.analysis
    return sticker as StickerRecord
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
