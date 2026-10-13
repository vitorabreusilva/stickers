// Keeps this device's collection and the server's in step. The device is the source of truth for
// its own edits: everything is saved locally first and queued in the outbox, then sent here. Changes
// from other devices are pulled after, so the app works the same offline or signed out.

import { api } from './account'
import { receiveBookTitle, storedBookTitle } from './book-title'
import { decodeAnalysis, encodeAnalysis } from './codec'
import {
  applyRemote,
  clearOutbox,
  getBook,
  getBookPage,
  getFolder,
  getMeta,
  getSticker,
  hasPending,
  listOutbox,
  queueEverything,
  setMeta,
  type BookPageRecord,
  type BookRecord,
  type FolderRecord,
  type OutboxEntry,
  type RemoteChange,
  type StickerRecord,
} from './db'
import { DEFAULT_STYLE, isCoverBackground, isCoverLayout, LEGACY_BOOK_ID, parseBookCover } from './books'
import type { ColoringDetail } from './coloring'
import type { StickerEffect } from './effects'
import { parseStickerAi } from './smart-groups'
import { cleanFolderName, isFolderColor, type FolderKey } from './folders'
import type { Rect } from './geometry'
import {
  IMAGE_TYPES,
  type ImageKind,
  type SyncBook,
  type SyncFolder,
  type SyncPull,
  type SyncPush,
  type SyncSticker,
} from './sync-protocol'
import type { TopicId } from './topics'

const PUSH_BATCH = 50
/**
 * Raised whenever the server starts sending something earlier versions of the app didn't keep (2:
 * coloring books, and which book each page is in; 3: pages with their colour guide hidden;
 * 4: what the AI says each sticker shows, and its AI folder; 5: folder names, the pictures stickers
 * were cut from, and single-sticker book covers). An installed app opens on its cached version
 * after an update and syncs once before the new one takes over, so that old version can move the
 * cursor past records it threw away. A new version pulls everything again to pick those up.
 */
const PULL_VERSION = 5
const DOWNLOADS_AT_ONCE = 4

/** The server said we're not signed in (any more). */
export class SignedOutError extends Error {}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(api(path), { credentials: 'same-origin', ...init })
  if (response.status === 401 || response.status === 403) throw new SignedOutError()
  return response
}

async function uploadImage(kind: ImageKind, id: string, blob: Blob) {
  const type = IMAGE_TYPES.includes(blob.type) ? blob.type : 'image/png'
  const response = await request(`images/${kind}/${id}`, { method: 'PUT', body: blob, headers: { 'Content-Type': type } })
  // A picture the server won't take would block the queue forever; leave it on this device only.
  if (response.status === 413 || response.status === 415) {
    console.warn(`Not syncing ${kind} ${id}: the server refused its picture (${response.status})`)
    return
  }
  if (!response.ok) throw new Error(`Upload failed (${response.status})`)
}

/** null when the server doesn't have it (e.g. it was too big to upload from the other device). */
async function downloadImage(kind: ImageKind, id: string): Promise<Blob | null> {
  const response = await request(`images/${kind}/${id}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Download failed (${response.status})`)
  return response.blob()
}

const stickerToSync = (s: StickerRecord): SyncSticker => ({
  id: s.id,
  width: s.width,
  height: s.height,
  createdAt: s.createdAt,
  analysis: s.analysis ? encodeAnalysis(s.analysis) : null,
  topic: s.topic ?? null,
  effect: s.effect ?? null,
  ai: s.ai ?? null,
  sourceRect: s.source && s.sourceRect ? s.sourceRect : null,
})

/** A synced rectangle of fractions, checked. */
function parseRect(raw: unknown): Rect | undefined {
  const r = raw as Rect | null
  const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= 2
  return r && ok(r.x) && ok(r.y) && ok(r.width) && ok(r.height) && r.width > 0 && r.height > 0
    ? { x: r.x, y: r.y, width: r.width, height: r.height }
    : undefined
}

const folderToSync = (f: FolderRecord): SyncFolder => ({ key: f.key, color: f.color ?? '', name: f.name ?? '' })

function folderFromSync(f: SyncFolder): FolderRecord | null {
  const name = typeof f.name === 'string' ? cleanFolderName(f.name) : ''
  const color = isFolderColor(f.color) ? f.color : undefined
  if (!name && !color) return null
  return { key: f.key as FolderKey, ...(color && { color }), ...(name && { name }) }
}

const pageToSync = (p: BookPageRecord) => ({
  id: p.id,
  bookId: p.bookId ?? LEGACY_BOOK_ID,
  stickerId: p.stickerId,
  effect: p.effect ?? null,
  detail: p.detail,
  hideGuide: !!p.hideGuide,
  position: p.position,
  createdAt: p.createdAt,
})

const bookToSync = (b: BookRecord): SyncBook => ({
  id: b.id,
  title: b.title,
  background: b.background,
  layout: b.layout,
  cover: b.cover ?? null,
  createdAt: b.createdAt,
})

function bookFromSync(b: SyncBook): BookRecord {
  const cover = parseBookCover(b.cover)
  return {
    id: b.id,
    title: b.title,
    background: isCoverBackground(b.background) ? b.background : DEFAULT_STYLE.background,
    layout: isCoverLayout(b.layout) ? b.layout : DEFAULT_STYLE.layout,
    ...(cover && { cover }),
    createdAt: b.createdAt,
  }
}

/** Sends one batch of the outbox. Returns false once it's empty. */
async function pushBatch(): Promise<boolean> {
  const entries = (await listOutbox()).slice(0, PUSH_BATCH)
  if (!entries.length) return false

  const body: Required<Omit<SyncPush, 'settings'>> & Pick<SyncPush, 'settings'> = {
    stickers: [],
    folders: [],
    book: [],
    books: [],
  }
  const sent: OutboxEntry[] = []
  for (const entry of entries) {
    if (entry.kind === 'sticker') {
      const sticker = await getSticker(entry.id)
      if (!sticker) body.stickers.push({ id: entry.id, deleted: true, width: 0, height: 0, createdAt: 0 })
      else {
        if (entry.images) {
          await uploadImage('sticker', sticker.id, sticker.blob)
          if (sticker.source) await uploadImage('sticker-source', sticker.id, sticker.source)
        }
        body.stickers.push(stickerToSync(sticker))
      }
    } else if (entry.kind === 'folder') {
      const folder = await getFolder(entry.id)
      if (folder) body.folders.push(folderToSync(folder))
    } else if (entry.kind === 'book') {
      const page = await getBookPage(entry.id)
      if (!page) body.book.push({ id: entry.id, deleted: true, stickerId: '', detail: '', position: 0, createdAt: 0 })
      else {
        if (entry.images) {
          await uploadImage('book-page', page.id, page.page)
          await uploadImage('book-sticker', page.id, page.sticker)
        }
        body.book.push(pageToSync(page))
      }
    } else if (entry.kind === 'book-info') {
      const book = await getBook(entry.id)
      body.books.push(book ? bookToSync(book) : { id: entry.id, deleted: true, title: '', background: '', layout: '', createdAt: 0 })
    } else {
      body.settings = { bookTitle: storedBookTitle() }
    }
    sent.push(entry)
  }

  const response = await request('sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Sync failed (${response.status})`)
  await clearOutbox(sent)
  return true
}

/** Runs `work` over `items`, a few at a time. */
async function inParallel<T>(items: T[], work: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(DOWNLOADS_AT_ONCE, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
    }),
  )
}

/** Pulls one page of changes from other devices. Returns whether there's more. */
async function pullPage(): Promise<boolean> {
  const since = (await getMeta<number>('cursor')) ?? 0
  const response = await request(`sync?since=${since}`)
  if (!response.ok) throw new Error(`Sync failed (${response.status})`)
  const page = (await response.json()) as SyncPull

  const stickers: RemoteChange<Omit<StickerRecord, 'blob'> & { blob?: Blob }>[] = []
  await inParallel(page.stickers, async (s) => {
    if (s.deleted) return void stickers.push({ deleted: true, key: s.id })
    // Pictures never change, so only new stickers need theirs downloaded.
    const known = !!(await getSticker(s.id))
    const blob = known ? undefined : await downloadImage('sticker', s.id)
    if (blob === null) return
    const sourceRect = parseRect(s.sourceRect)
    // Without the picture it was cut from, a sticker is still a sticker.
    const source = !known && sourceRect ? await downloadImage('sticker-source', s.id) : undefined
    const analysis = decodeAnalysis(s.analysis)
    const ai = parseStickerAi(s.ai)
    stickers.push({
      key: s.id,
      record: {
        id: s.id,
        width: s.width,
        height: s.height,
        createdAt: s.createdAt,
        ...(analysis && { analysis }),
        ...(s.topic && { topic: s.topic as TopicId }),
        ...(s.effect && { effect: s.effect as StickerEffect }),
        ...(ai && { ai }),
        ...(blob && { blob }),
        ...(sourceRect && (known || source) && { sourceRect }),
        ...(source && { source }),
      },
    })
  })

  const book: RemoteChange<Omit<BookPageRecord, 'page' | 'sticker'> & { page?: Blob; sticker?: Blob }>[] = []
  await inParallel(page.book, async (p) => {
    if (p.deleted) return void book.push({ deleted: true, key: p.id })
    const known = !!(await getBookPage(p.id))
    const [pageImage, stickerImage] = known
      ? [undefined, undefined]
      : await Promise.all([downloadImage('book-page', p.id), downloadImage('book-sticker', p.id)])
    if (pageImage === null || stickerImage === null) return
    book.push({
      key: p.id,
      record: {
        id: p.id,
        ...(p.bookId && p.bookId !== LEGACY_BOOK_ID && { bookId: p.bookId }),
        stickerId: p.stickerId,
        detail: p.detail as ColoringDetail,
        ...(p.hideGuide && { hideGuide: true }),
        position: p.position,
        createdAt: p.createdAt,
        ...(p.effect && { effect: p.effect as StickerEffect }),
        ...(pageImage && { page: pageImage }),
        ...(stickerImage && { sticker: stickerImage }),
      },
    })
  })

  const folders = page.folders.flatMap((f) => folderFromSync(f) ?? [])
  // The title first, so it's in place when the screens reload for the records.
  if (page.settings && !(await hasPending('settings', 'book'))) receiveBookTitle(page.settings.bookTitle)
  const books = (page.books ?? []).map((b) =>
    b.deleted ? { deleted: true as const, key: b.id } : { key: b.id, record: bookFromSync(b) },
  )
  await applyRemote({ stickers, folders, book, books })
  await setMeta('cursor', page.rev)
  return page.more
}

/**
 * One full round: send what changed here, then fetch what changed elsewhere. The first time an
 * account syncs on this device, the whole local collection is sent to it.
 */
export async function syncOnce(accountKey: string) {
  if ((await getMeta<string>('account')) !== accountKey) {
    await queueEverything({ bookTitle: storedBookTitle() !== null })
    await setMeta('cursor', 0)
    await setMeta('account', accountKey)
    await setMeta('pullVersion', PULL_VERSION)
  }
  if ((await getMeta<number>('pullVersion')) !== PULL_VERSION) {
    await setMeta('cursor', 0)
    await setMeta('pullVersion', PULL_VERSION)
  }
  // Bounded, in case edits keep arriving while we send.
  for (let i = 0; i < 1000 && (await pushBatch()); i++);
  for (let i = 0; i < 1000 && (await pullPage()); i++);
}
