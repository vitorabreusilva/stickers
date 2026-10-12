// Runs the real API against Postgres (npm run db:up && npm run db:migrate). Skipped without DATABASE_URL.
import { testUtils } from 'better-auth/plugins'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

try {
  process.loadEnvFile('.env.local')
} catch {
  // CI sets the environment directly.
}
process.env.BETTER_AUTH_SECRET ||= 'test-secret-test-secret-test-secret'
process.env.ALLOWED_EMAILS = ''

const { createApp } = await import('../../server/app')
const { createAuth } = await import('../../server/auth')
const { setImageStore } = await import('../../server/images')
const { getDb } = await import('../../server/db/client')
const { user } = await import('../../server/db/schema')
const { isAllowed } = await import('../../server/env')
const { inArray } = await import('drizzle-orm')

const images = new Map<string, { body: Uint8Array<ArrayBuffer>; contentType: string }>()
setImageStore({
  async put(path, body, contentType) {
    images.set(path, { body: new Uint8Array(body), contentType })
  },
  async get(path) {
    return images.get(path) ?? null
  },
  async delete(paths) {
    paths.forEach((p) => images.delete(p))
  },
})

const auth = createAuth([testUtils()])
// The plugin adds `test` to the context, which the shared createAuth's type can't know about.
type TestHelpers = {
  createUser(user: { email: string; name?: string }): { id: string }
  saveUser<T extends { id: string }>(user: T): Promise<T>
  getAuthHeaders(opts: { userId: string }): Promise<Headers>
}
const helpers = async () => ((await auth.$context) as unknown as { test: TestHelpers }).test
const app = createApp(() => auth)
const run = Math.random().toString(36).slice(2, 8)
const created: string[] = []

/** Invites `email`, makes the account and signs in. */
async function signIn(email: string) {
  process.env.ALLOWED_EMAILS += `,${email.toUpperCase()}`
  const test = await helpers()
  const saved = await test.saveUser(test.createUser({ email, name: 'Test' }))
  created.push(saved.id)
  const headers = await test.getAuthHeaders({ userId: saved.id })
  return { id: saved.id, cookie: headers.get('cookie')! }
}

const call = (cookie: string, path: string, init: RequestInit = {}) =>
  app.request(`/api${path}`, { ...init, headers: { cookie, ...init.headers } })

const pushJson = (cookie: string, body: unknown) =>
  call(cookie, '/sync', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const pullJson = async (cookie: string, since = 0) => (await call(cookie, `/sync?since=${since}`)).json()

describe('allowlist', () => {
  it('lets in listed emails, any case, and * for everyone; empty lets in no one', () => {
    expect(isAllowed('me@example.com', 'a@b.c, Me@Example.com')).toBe(true)
    expect(isAllowed('stranger@example.com', 'a@b.c')).toBe(false)
    expect(isAllowed('stranger@example.com', '*')).toBe(true)
    expect(isAllowed('me@example.com', '')).toBe(false)
  })
})

describe.skipIf(!process.env.DATABASE_URL)('api', () => {
  let me: { id: string; cookie: string }

  beforeAll(async () => {
    me = await signIn(`me+${run}@example.com`)
  })

  afterAll(async () => {
    if (created.length) await getDb().delete(user).where(inArray(user.id, created))
  })

  it('turns away people who are signed out or not invited', async () => {
    expect((await app.request('/api/sync')).status).toBe(401)
    // The allowlist is checked per request, not only when the account was made.
    const ex = await signIn(`ex+${run}@example.com`)
    expect((await call(ex.cookie, '/account')).status).toBe(200)
    process.env.ALLOWED_EMAILS = process.env.ALLOWED_EMAILS!.replace(`,ex+${run}@example.com`.toUpperCase(), '')
    expect((await call(ex.cookie, '/account')).status).toBe(403)

    // And nobody new gets an account without an invite.
    const test = await helpers()
    await expect(test.saveUser(test.createUser({ email: `stranger+${run}@example.com` }))).rejects.toThrow(/not invited/)
  })

  it('syncs stickers, folders, book pages and settings, oldest change first', async () => {
    expect(await (await call(me.cookie, '/account')).json()).toMatchObject({ email: `me+${run}@example.com` })

    const start = (await pullJson(me.cookie)).rev
    expect(start).toBe(0)

    expect(
      (
        await pushJson(me.cookie, {
          stickers: [
            { id: 's1', width: 512, height: 600, createdAt: 1, topic: 'dogs', analysis: { version: 1, embedding: 'AAAA' } },
            { id: 's2', width: 10, height: 10, createdAt: 2, effect: 'holo' },
          ],
          folders: [{ key: 'dogs', color: 'mint' }],
          book: [
            { id: 'p1', stickerId: 's1', detail: 'simple', position: 0, createdAt: 3 },
            { id: 'p2', bookId: 'b2', stickerId: 's2', detail: 'medium', position: 0, createdAt: 4 },
          ],
          books: [{ id: 'b2', title: 'Holiday', background: 'night', layout: 'wild', createdAt: 4 }],
          settings: { bookTitle: 'Rex' },
        })
      ).status,
    ).toBe(200)

    const first = await pullJson(me.cookie)
    expect(first.more).toBe(false)
    expect(first.stickers).toEqual([
      { id: 's1', width: 512, height: 600, createdAt: 1, topic: 'dogs', effect: null, analysis: { version: 1, embedding: 'AAAA' } },
      { id: 's2', width: 10, height: 10, createdAt: 2, topic: null, effect: 'holo', analysis: null },
    ])
    expect(first.folders).toEqual([{ key: 'dogs', color: 'mint' }])
    // Pages from devices that don't know about books yet land in the first book.
    expect(first.book).toEqual([
      { id: 'p1', bookId: 'default', stickerId: 's1', detail: 'simple', position: 0, createdAt: 3, effect: null },
      { id: 'p2', bookId: 'b2', stickerId: 's2', detail: 'medium', position: 0, createdAt: 4, effect: null },
    ])
    expect(first.books).toEqual([{ id: 'b2', title: 'Holiday', background: 'night', layout: 'wild', createdAt: 4 }])
    expect(first.settings).toEqual({ bookTitle: 'Rex' })

    // Only what changed comes back next time, deletions included.
    await pushJson(me.cookie, {
      stickers: [{ id: 's2', deleted: true }],
      folders: [{ key: 'dogs', color: 'gold' }],
      books: [{ id: 'b2', deleted: true }],
    })
    const second = await pullJson(me.cookie, first.rev)
    expect(second.stickers).toEqual([{ id: 's2', deleted: true, width: 0, height: 0, createdAt: 0 }])
    expect(second.folders).toEqual([{ key: 'dogs', color: 'gold' }])
    expect(second.book).toEqual([])
    expect(second.books).toEqual([{ id: 'b2', deleted: true, title: '', background: '', layout: '', createdAt: 0 }])

    // A device that doesn't know about books moving a page leaves it in its book.
    await pushJson(me.cookie, { book: [{ id: 'p2', stickerId: 's2', detail: 'medium', position: 3, createdAt: 4 }] })
    const third = await pullJson(me.cookie, second.rev)
    expect(third.book).toEqual([
      { id: 'p2', bookId: 'b2', stickerId: 's2', detail: 'medium', position: 3, createdAt: 4, effect: null },
    ])
    expect(second.settings).toBeUndefined()
    expect((await pullJson(me.cookie, second.rev)).stickers).toEqual([])
  })

  it('pages through big pulls without losing anything', async () => {
    const other = await signIn(`friend+${run}@example.com`)
    const many = Array.from({ length: 450 }, (_, i) => ({ id: `m${i}`, width: 1, height: 1, createdAt: i }))
    await pushJson(other.cookie, { stickers: many.slice(0, 300), folders: [{ key: 'all', color: 'sky' }] })
    await pushJson(other.cookie, { stickers: many.slice(300) })
    const seen: string[] = []
    let since = 0
    let pages = 0
    for (;;) {
      const page = await pullJson(other.cookie, since)
      seen.push(...page.stickers.map((s: { id: string }) => s.id))
      since = page.rev
      pages++
      if (!page.more) break
    }
    expect(pages).toBe(3)
    expect(seen).toEqual(many.map((s) => s.id))
    // And none of it is visible to anyone else.
    expect((await pullJson(me.cookie)).stickers.map((s: { id: string }) => s.id)).toEqual(['s1', 's2'])
  })

  it('stores pictures per person, and deletes them with their sticker', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    const put = (kind: string, id: string, type = 'image/png', cookie = me.cookie) =>
      call(cookie, `/images/${kind}/${id}`, { method: 'PUT', body: png, headers: { 'content-type': type } })

    expect((await put('sticker', 's1')).status).toBe(200)
    const back = await call(me.cookie, '/images/sticker/s1')
    expect(back.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(png)

    expect((await put('sticker', 's1', 'image/svg+xml')).status).toBe(415)
    expect((await put('avatar', 's1')).status).toBe(404)
    expect((await put('sticker', '..%2F..%2Fx')).status).toBe(404)

    const stranger = await signIn(`friend2+${run}@example.com`)
    expect((await call(stranger.cookie, '/images/sticker/s1')).status).toBe(404)

    await pushJson(me.cookie, { stickers: [{ id: 's1', deleted: true }] })
    expect((await call(me.cookie, '/images/sticker/s1')).status).toBe(404)
  })

  it('rejects malformed pushes', async () => {
    expect((await pushJson(me.cookie, { stickers: [{ id: '../x' }] })).status).toBe(400)
    expect((await call(me.cookie, '/sync', { method: 'POST', body: '{}' })).status).toBe(415)
    expect((await call(me.cookie, '/sync?since=-1')).status).toBe(400)
  })
})
