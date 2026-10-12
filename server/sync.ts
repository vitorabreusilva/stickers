import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  IMAGE_KINDS,
  IMAGE_TYPES,
  isRecordId,
  MAX_IMAGE_BYTES,
  MAX_PUSH_RECORDS,
  type ImageKind,
  type SyncBook,
  type SyncBookPage,
  type SyncFolder,
  type SyncPull,
  type SyncPush,
  type SyncSticker,
} from '../src/lib/sync-protocol.js'
import { getDb, type Db } from './db/client.js'
import { bookPages, books, folders, nextRev, settings, stickers } from './db/schema.js'
import { getImageStore } from './images.js'

export type SignedIn = { Variables: { userId: string } }

const PULL_LIMIT = 200

const imagePath = (userId: string, kind: ImageKind, id: string) => `users/${userId}/${kind}/${id}`

// Requests come from our own app, but are still checked: anything else is rejected, not stored.

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : null)
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0)
const optional = (v: unknown, max: number) => (v == null ? null : str(v, max))

class BadRequest extends Error {}

function cleanSticker(raw: unknown): SyncSticker {
  const s = raw as SyncSticker
  if (!isRecordId(s?.id)) throw new BadRequest('Bad sticker id')
  if (s.deleted) return { id: s.id, deleted: true, width: 0, height: 0, createdAt: 0 }
  const analysis = s.analysis && typeof s.analysis === 'object' ? s.analysis : null
  if (analysis && JSON.stringify(analysis).length > 64_000) throw new BadRequest('Analysis too large')
  return {
    id: s.id,
    width: int(s.width),
    height: int(s.height),
    createdAt: int(s.createdAt),
    analysis,
    topic: optional(s.topic, 40),
    effect: optional(s.effect, 40),
  }
}

function cleanFolder(raw: unknown): SyncFolder {
  const f = raw as SyncFolder
  const key = str(f?.key, 80)
  const color = str(f?.color, 40)
  if (!key || !color) throw new BadRequest('Bad folder')
  return { key, color }
}

const LEGACY_BOOK_ID = 'default'

/** A page as pushed; `bookId` stays missing when the device doesn't know about books. */
function cleanPage(raw: unknown): SyncBookPage {
  const p = raw as SyncBookPage
  if (!isRecordId(p?.id)) throw new BadRequest('Bad page id')
  if (p.deleted) return { id: p.id, deleted: true, stickerId: '', detail: '', position: 0, createdAt: 0 }
  if (p.bookId != null && !isRecordId(p.bookId)) throw new BadRequest('Bad book id')
  return {
    id: p.id,
    ...(p.bookId != null && { bookId: p.bookId }),
    stickerId: str(p.stickerId, 64) ?? '',
    effect: optional(p.effect, 40),
    detail: str(p.detail, 40) ?? 'medium',
    position: int(p.position),
    createdAt: int(p.createdAt),
  }
}

function cleanBook(raw: unknown): SyncBook {
  const b = raw as SyncBook
  if (!isRecordId(b?.id)) throw new BadRequest('Bad book id')
  if (b.deleted) return { id: b.id, deleted: true, title: '', background: '', layout: '', createdAt: 0 }
  return {
    id: b.id,
    title: str(b.title, 200) ?? '',
    background: str(b.background, 40) ?? 'cream',
    layout: str(b.layout, 40) ?? 'playful',
    createdAt: int(b.createdAt),
  }
}

/** Keeps the last change to each record, since one statement can't touch a row twice. */
function lastOf<T>(items: T[], key: (item: T) => string) {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

async function push(db: Db, userId: string, body: SyncPush) {
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
  const newStickers = lastOf(list(body.stickers).map(cleanSticker), (s) => s.id)
  const newFolders = lastOf(list(body.folders).map(cleanFolder), (f) => f.key)
  const newPages = lastOf(list(body.book).map(cleanPage), (p) => p.id)
  const newBooks = lastOf(list(body.books).map(cleanBook), (b) => b.id)
  if (newStickers.length + newFolders.length + newPages.length + newBooks.length > MAX_PUSH_RECORDS) {
    throw new BadRequest('Too many')
  }

  await db.transaction(async (tx) => {
    // One writer per person at a time, so revision numbers become visible in order and a device
    // reading "everything after N" can't skip a row that commits late.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)

    if (newStickers.length) {
      await tx
        .insert(stickers)
        .values(newStickers.map((s) => ({ ...s, userId, deleted: !!s.deleted })))
        .onConflictDoUpdate({
          target: [stickers.userId, stickers.id],
          set: {
            rev: nextRev,
            deleted: sql`excluded.deleted`,
            width: sql`excluded.width`,
            height: sql`excluded.height`,
            createdAt: sql`excluded.created_at`,
            analysis: sql`excluded.analysis`,
            topic: sql`excluded.topic`,
            effect: sql`excluded.effect`,
          },
        })
    }
    if (newFolders.length) {
      await tx
        .insert(folders)
        .values(newFolders.map((f) => ({ ...f, userId })))
        .onConflictDoUpdate({ target: [folders.userId, folders.key], set: { rev: nextRev, color: sql`excluded.color` } })
    }
    // Devices that don't know about books yet send pages without one. New pages from them go in
    // the first book, and their edits (a new position, say) leave the page in its book.
    for (const knowsBooks of [false, true]) {
      const pages = newPages.filter((p) => (p.bookId !== undefined) === knowsBooks)
      if (!pages.length) continue
      await tx
        .insert(bookPages)
        .values(pages.map((p) => ({ ...p, bookId: p.bookId ?? LEGACY_BOOK_ID, userId, deleted: !!p.deleted })))
        .onConflictDoUpdate({
          target: [bookPages.userId, bookPages.id],
          set: {
            rev: nextRev,
            deleted: sql`excluded.deleted`,
            ...(knowsBooks && { bookId: sql`excluded.book_id` }),
            stickerId: sql`excluded.sticker_id`,
            effect: sql`excluded.effect`,
            detail: sql`excluded.detail`,
            position: sql`excluded.position`,
            createdAt: sql`excluded.created_at`,
          },
        })
    }
    if (newBooks.length) {
      await tx
        .insert(books)
        .values(newBooks.map((b) => ({ ...b, userId, deleted: !!b.deleted })))
        .onConflictDoUpdate({
          target: [books.userId, books.id],
          set: {
            rev: nextRev,
            deleted: sql`excluded.deleted`,
            title: sql`excluded.title`,
            background: sql`excluded.background`,
            layout: sql`excluded.layout`,
            createdAt: sql`excluded.created_at`,
          },
        })
    }
    if (body.settings && typeof body.settings === 'object') {
      const bookTitle = optional(body.settings.bookTitle, 200)
      await tx
        .insert(settings)
        .values({ userId, bookTitle })
        .onConflictDoUpdate({ target: settings.userId, set: { rev: nextRev, bookTitle } })
    }
  })

  // Deleted records keep a tombstone row, but their pictures can go. Best effort: a leftover file
  // costs a little storage, not correctness.
  const gone = [
    ...newStickers.filter((s) => s.deleted).map((s) => imagePath(userId, 'sticker', s.id)),
    ...newPages
      .filter((p) => p.deleted)
      .flatMap((p) => [imagePath(userId, 'book-page', p.id), imagePath(userId, 'book-sticker', p.id)]),
  ]
  await getImageStore()
    .delete(gone)
    .catch((err) => console.warn('Could not delete images', err))
}

async function pull(db: Db, userId: string, since: number): Promise<SyncPull> {
  const [s, f, b, bk, settingsRows] = await Promise.all([
    db
      .select()
      .from(stickers)
      .where(and(eq(stickers.userId, userId), gt(stickers.rev, since)))
      .orderBy(asc(stickers.rev))
      .limit(PULL_LIMIT + 1),
    db
      .select()
      .from(folders)
      .where(and(eq(folders.userId, userId), gt(folders.rev, since)))
      .orderBy(asc(folders.rev))
      .limit(PULL_LIMIT + 1),
    db
      .select()
      .from(bookPages)
      .where(and(eq(bookPages.userId, userId), gt(bookPages.rev, since)))
      .orderBy(asc(bookPages.rev))
      .limit(PULL_LIMIT + 1),
    db
      .select()
      .from(books)
      .where(and(eq(books.userId, userId), gt(books.rev, since)))
      .orderBy(asc(books.rev))
      .limit(PULL_LIMIT + 1),
    db
      .select()
      .from(settings)
      .where(and(eq(settings.userId, userId), gt(settings.rev, since))),
  ])

  // Keep the PULL_LIMIT oldest changes across all tables. Each table returned its own oldest
  // PULL_LIMIT + 1, so nothing older than the cut-off can be missing.
  type Row =
    | { rev: number; kind: 'sticker'; row: (typeof s)[number] }
    | { rev: number; kind: 'folder'; row: (typeof f)[number] }
    | { rev: number; kind: 'page'; row: (typeof b)[number] }
    | { rev: number; kind: 'book'; row: (typeof bk)[number] }
    | { rev: number; kind: 'settings'; row: (typeof settingsRows)[number] }
  const all: Row[] = [
    ...s.map((row) => ({ rev: row.rev, kind: 'sticker' as const, row })),
    ...f.map((row) => ({ rev: row.rev, kind: 'folder' as const, row })),
    ...b.map((row) => ({ rev: row.rev, kind: 'page' as const, row })),
    ...bk.map((row) => ({ rev: row.rev, kind: 'book' as const, row })),
    ...settingsRows.map((row) => ({ rev: row.rev, kind: 'settings' as const, row })),
  ].sort((x, y) => x.rev - y.rev)
  const more = all.length > PULL_LIMIT
  const kept = all.slice(0, PULL_LIMIT)

  const result: SyncPull = { rev: kept.at(-1)?.rev ?? since, more, stickers: [], folders: [], book: [], books: [] }
  for (const item of kept) {
    if (item.kind === 'sticker') {
      const { row } = item
      result.stickers.push(
        row.deleted
          ? { id: row.id, deleted: true, width: 0, height: 0, createdAt: 0 }
          : {
              id: row.id,
              width: row.width,
              height: row.height,
              createdAt: row.createdAt,
              analysis: (row.analysis as SyncSticker['analysis']) ?? null,
              topic: row.topic,
              effect: row.effect,
            },
      )
    } else if (item.kind === 'folder') {
      result.folders.push({ key: item.row.key, color: item.row.color })
    } else if (item.kind === 'page') {
      const { row } = item
      result.book.push(
        row.deleted
          ? { id: row.id, deleted: true, stickerId: '', detail: '', position: 0, createdAt: 0 }
          : {
              id: row.id,
              bookId: row.bookId,
              stickerId: row.stickerId,
              effect: row.effect,
              detail: row.detail,
              position: row.position,
              createdAt: row.createdAt,
            },
      )
    } else if (item.kind === 'book') {
      const { row } = item
      result.books.push(
        row.deleted
          ? { id: row.id, deleted: true, title: '', background: '', layout: '', createdAt: 0 }
          : { id: row.id, title: row.title, background: row.background, layout: row.layout, createdAt: row.createdAt },
      )
    } else {
      result.settings = { bookTitle: item.row.bookTitle }
    }
  }
  return result
}

/** The collection API. Expects `userId` to be set by the sign-in check in front of it. */
export const syncRoutes = new Hono<SignedIn>()
  .onError((err, c) => {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400)
    throw err
  })
  .get('/sync', async (c) => {
    const since = Number(c.req.query('since') ?? 0)
    if (!Number.isSafeInteger(since) || since < 0) return c.json({ error: 'Bad since' }, 400)
    c.header('Cache-Control', 'no-store')
    return c.json(await pull(getDb(), c.get('userId'), since))
  })
  .post('/sync', bodyLimit({ maxSize: 4_000_000 }), async (c) => {
    if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'Send JSON' }, 415)
    const body = await c.req.json<SyncPush>().catch(() => null)
    if (!body || typeof body !== 'object') return c.json({ error: 'Bad body' }, 400)
    await push(getDb(), c.get('userId'), body)
    return c.json({ ok: true })
  })
  .put('/images/:kind/:id', bodyLimit({ maxSize: MAX_IMAGE_BYTES }), async (c) => {
    const { kind, id } = c.req.param()
    const type = c.req.header('content-type') ?? ''
    if (!IMAGE_KINDS.includes(kind as ImageKind) || !isRecordId(id)) return c.json({ error: 'Not found' }, 404)
    if (!IMAGE_TYPES.includes(type)) return c.json({ error: 'Unsupported image type' }, 415)
    const body = await c.req.arrayBuffer()
    if (!body.byteLength) return c.json({ error: 'Empty image' }, 400)
    await getImageStore().put(imagePath(c.get('userId'), kind as ImageKind, id), body, type)
    return c.json({ ok: true })
  })
  .get('/images/:kind/:id', async (c) => {
    const { kind, id } = c.req.param()
    if (!IMAGE_KINDS.includes(kind as ImageKind) || !isRecordId(id)) return c.json({ error: 'Not found' }, 404)
    const image = await getImageStore().get(imagePath(c.get('userId'), kind as ImageKind, id))
    if (!image) return c.json({ error: 'Not found' }, 404)
    return c.body(image.body, 200, {
      'Content-Type': image.contentType,
      'Cache-Control': 'private, no-cache',
      'X-Content-Type-Options': 'nosniff',
    })
  })
