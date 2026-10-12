// Two "devices" (browser profiles) signed in to one account, syncing through the real API and
// Postgres. Needs DATABASE_URL (npm run db:up && npm run db:migrate); skipped without it.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { testUtils } from 'better-auth/plugins'

try {
  process.loadEnvFile('.env.local')
} catch {
  // CI sets the environment directly.
}

export const E2E_EMAIL = 'e2e@stickers.test'

test.skip(!process.env.DATABASE_URL, 'needs DATABASE_URL')

/** A fresh account with the e2e email, and its session cookies. */
async function account() {
  process.env.ALLOWED_EMAILS = E2E_EMAIL
  const { createAuth } = await import('../server/auth')
  const { getDb } = await import('../server/db/client')
  const { user } = await import('../server/db/schema')
  const { eq } = await import('drizzle-orm')
  await getDb().delete(user).where(eq(user.email, E2E_EMAIL))

  const auth = createAuth([testUtils()])
  type Helpers = {
    createUser(user: { email: string; name?: string }): { id: string }
    saveUser<T extends { id: string }>(user: T): Promise<T>
    getCookies(opts: { userId: string; domain?: string }): Promise<
      { name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; expires?: number }[]
    >
  }
  const helpers = ((await auth.$context) as unknown as { test: Helpers }).test
  const saved = await helpers.saveUser(helpers.createUser({ email: E2E_EMAIL, name: 'Sticker Fan' }))
  return helpers.getCookies({ userId: saved.id, domain: 'localhost' })
}

async function device(browser: Browser, cookies: Awaited<ReturnType<typeof account>>) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 412, height: 860 } })
  await context.addCookies(cookies)
  return context.newPage()
}

/** Resolves once `page` has sent its changes to the server. */
const pushed = (page: Page) =>
  page.waitForResponse((r) => r.url().endsWith('/api/sync') && r.request().method() === 'POST' && r.ok())

/** Resolves once `page` has fetched changes from the server. */
const pulled = (page: Page) =>
  page.waitForResponse((r) => r.url().includes('/api/sync?since=') && r.ok())

test('a collection follows you to another device, both ways', async ({ browser }) => {
  test.setTimeout(120_000)
  const cookies = await account()
  const phone = await device(browser, cookies)
  const laptop = await device(browser, cookies)

  // The phone already has stickers from before it was signed in.
  await phone.goto('/')
  const sun = await phone.evaluate(async () => {
    const canvas = new OffscreenCanvas(300, 200)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffd23f'
    ctx.fillRect(0, 0, 300, 200)
    return Array.from(new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()))
  })
  await phone.getByRole('button', { name: 'Settings' }).click()
  const phoneSheet = phone.getByRole('dialog', { name: 'Settings' })
  await expect(phoneSheet.getByText(E2E_EMAIL)).toBeVisible()
  await phoneSheet.getByRole('button', { name: 'Close' }).click()

  // Make a sticker the quick way: restore a one-sticker backup.
  await phone.getByRole('button', { name: 'Settings' }).click()
  const backup = {
    format: 'stickers-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: [],
    bookTitle: 'Sunny',
    stickers: [
      { id: 'sun-1', width: 300, height: 200, createdAt: 1, topic: 'food', blob: { type: 'image/png', base64: Buffer.from(sun).toString('base64') } },
      { id: 'sun-2', width: 300, height: 200, createdAt: 2, topic: 'music', blob: { type: 'image/png', base64: Buffer.from(sun).toString('base64') } },
    ],
    book: [],
  }
  await phoneSheet.getByTestId('backup-input').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await phoneSheet.getByRole('button', { name: 'Restore' }).click()
  await expect(phone.getByRole('list', { name: 'Folders' }).getByRole('button', { name: 'All stickers, 2 stickers' })).toBeVisible({ timeout: 10_000 })

  // Wait for the phone to finish sending.
  await phone.getByRole('button', { name: 'Settings' }).click()
  await expect(phoneSheet.getByText(/^Synced at /)).toBeVisible({ timeout: 15_000 })
  await phoneSheet.getByRole('button', { name: 'Close' }).click()

  // The laptop picks everything up, pictures included.
  await laptop.goto('/')
  const laptopFolders = laptop.getByRole('list', { name: 'Folders' })
  await expect(laptopFolders.getByRole('button', { name: 'All stickers, 2 stickers' })).toBeVisible({ timeout: 15_000 })
  const size = await laptop.locator('.folder-sticker img, .folder img').first().evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    return [img.naturalWidth, img.naturalHeight]
  })
  expect(size).toEqual([300, 200])
  await expect.poll(() => laptop.evaluate(() => localStorage.getItem('stickers.bookTitle'))).toBe('Sunny')

  // A folder colour picked on the laptop shows up on the phone.
  await laptopFolders.getByRole('button', { name: /^Food & drinks/ }).click()
  const colour = pushed(laptop)
  await laptop.getByRole('dialog', { name: 'Food & drinks' }).getByRole('radio', { name: 'Mint' }).click()
  await colour
  await laptop.goBack()
  const laptopSheet = laptop.getByRole('dialog', { name: 'Settings' })

  await phone.getByRole('button', { name: 'Settings' }).click()
  const phonePull = pulled(phone)
  await phoneSheet.getByRole('button', { name: 'Sync now' }).click()
  await phonePull
  await phoneSheet.getByRole('button', { name: 'Close' }).click()
  const phoneFolders = phone.getByRole('list', { name: 'Folders' })
  await phoneFolders.getByRole('button', { name: /^Food & drinks/ }).click()
  await expect(phone.getByRole('dialog', { name: 'Food & drinks' }).getByRole('radio', { name: 'Mint' })).toHaveAttribute('aria-checked', 'true')

  // Deleting on the phone removes it from the laptop.
  await phone.getByRole('dialog', { name: 'Food & drinks' }).getByRole('button', { name: 'Open sticker' }).click()
  const detail = phone.getByRole('dialog', { name: 'Sticker', exact: true })
  await detail.getByRole('button', { name: 'Delete' }).click()
  const deletion = pushed(phone)
  await detail.getByRole('button', { name: 'Sure?' }).click()
  await deletion

  await laptop.getByRole('button', { name: 'Settings' }).click()
  const laptopPull = pulled(laptop)
  await laptopSheet.getByRole('button', { name: 'Sync now' }).click()
  await laptopPull
  await laptopSheet.getByRole('button', { name: 'Close' }).click()
  await expect(laptop.getByRole('button', { name: 'Open sticker' })).toHaveCount(1)

  // Signing out keeps the stickers on the device.
  await laptop.getByRole('button', { name: 'Settings' }).click()
  await laptopSheet.getByRole('button', { name: 'Sign out' }).click()
  await expect(laptopSheet.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await laptopSheet.getByRole('button', { name: 'Close' }).click()
  await expect(laptop.getByRole('button', { name: 'Open sticker' })).toHaveCount(1)
})

test('coloring books follow you to another device', async ({ browser }) => {
  test.setTimeout(120_000)
  const cookies = await account()
  const phone = await device(browser, cookies)
  const laptop = await device(browser, cookies)

  await phone.goto('/')
  const image = await phone.evaluate(async () => {
    const canvas = new OffscreenCanvas(60, 80)
    canvas.getContext('2d')!.fillRect(0, 0, 60, 80)
    return btoa(String.fromCharCode(...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())))
  })
  const blob = { type: 'image/png', base64: image }
  const page = (id: string, position: number, bookId?: string) => ({
    id,
    ...(bookId && { bookId }),
    stickerId: 's1',
    sticker: blob,
    page: blob,
    detail: 'medium',
    position,
    createdAt: position + 10,
  })
  const backup = {
    format: 'stickers-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: [],
    bookTitle: 'Old one',
    stickers: [{ id: 's1', width: 60, height: 80, createdAt: 1, topic: 'food', blob }],
    books: [{ id: 'trip', title: 'Road Trip', background: 'night', layout: 'wild', createdAt: 5 }],
    book: [page('p1', 0, 'trip'), page('p2', 1, 'trip'), page('p3', 0)],
  }
  await phone.getByRole('button', { name: 'Settings' }).click()
  const phoneSheet = phone.getByRole('dialog', { name: 'Settings' })
  await phoneSheet.getByTestId('backup-input').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await phoneSheet.getByRole('button', { name: 'Restore' }).click()
  const phoneShelf = phone.getByRole('list', { name: 'Coloring books' })
  await expect(phoneShelf.getByRole('button', { name: 'Road Trip, 2 pages' })).toBeVisible({ timeout: 10_000 })
  await phone.getByRole('button', { name: 'Settings' }).click()
  await expect(phoneSheet.getByText(/^Synced at /)).toBeVisible({ timeout: 15_000 })
  await phoneSheet.getByRole('button', { name: 'Close' }).click()

  // The laptop gets both books, the first one under its old title.
  await laptop.goto('/')
  const laptopShelf = laptop.getByRole('list', { name: 'Coloring books' })
  await expect(laptopShelf.getByRole('button', { name: 'Road Trip, 2 pages' })).toBeVisible({ timeout: 15_000 })
  await expect(laptopShelf.getByRole('button', { name: 'Old one, 1 page' })).toBeVisible()

  // An installed app opens on its cached version after an update and syncs once with it. Like the
  // version before books, that run keeps the pages without their book, drops the books, and moves
  // the cursor past them. The new version must fetch them again.
  await laptop.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('stickers')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    const tx = db.transaction(['books', 'book', 'meta'], 'readwrite')
    tx.objectStore('books').clear()
    const pages = tx.objectStore('book')
    pages.getAll().onsuccess = (e) => {
      for (const { bookId: _, ...page } of (e.target as IDBRequest).result) pages.put(page)
    }
    tx.objectStore('meta').delete('pullVersion')
    await new Promise((resolve) => (tx.oncomplete = resolve))
    db.close()
  })
  await laptop.reload()
  await expect(laptopShelf.getByRole('button', { name: 'Road Trip, 2 pages' })).toBeVisible({ timeout: 15_000 })
  await expect(laptopShelf.getByRole('button', { name: 'Old one, 1 page' })).toBeVisible()

  // A new book made on the laptop shows up on the phone.
  const made = pushed(laptop)
  await laptopShelf.getByRole('button', { name: 'New book' }).click()
  const book = laptop.getByRole('dialog', { name: 'Coloring book' })
  await book.getByLabel('Title').fill('Made on laptop')
  await book.getByRole('radio', { name: 'Tidy' }).click()
  await made
  await laptop.goBack()
  await expect(laptopShelf.getByRole('button', { name: 'Made on laptop, 0 pages' })).toBeVisible()
  await laptop.getByRole('button', { name: 'Settings' }).click()
  await expect(laptop.getByRole('dialog', { name: 'Settings' }).getByText(/^Synced at /)).toBeVisible({ timeout: 15_000 })

  await phone.getByRole('button', { name: 'Settings' }).click()
  const phonePull = pulled(phone)
  await phoneSheet.getByRole('button', { name: 'Sync now' }).click()
  await phonePull
  await phoneSheet.getByRole('button', { name: 'Close' }).click()
  await expect(phoneShelf.getByRole('button', { name: 'Made on laptop, 0 pages' })).toBeVisible({ timeout: 10_000 })
})

test('AI folders sort a signed-in collection and follow it to other devices', async ({ browser }) => {
  test.setTimeout(120_000)
  const cookies = await account()
  const phone = await device(browser, cookies)
  const laptop = await device(browser, cookies)

  // The server's AI stands in: three Bluey characters and a pizza.
  const subjects = ['Bluey', 'Bingo', 'Bandit', 'Pizza slice']
  let described = 0
  const groupings: { stickers: { id: string; series: string }[]; folders: { name: string }[] }[] = []
  await phone.route('**/api/ai/providers', (route) => route.fulfill({ json: { providers: [], folders: true } }))
  await phone.route('**/api/ai/describe', (route) => {
    const subject = subjects[described++ % subjects.length]
    const bluey = subject !== 'Pizza slice'
    route.fulfill({
      json: { version: 1, subject, series: bluey ? 'Bluey' : '', tags: ['cartoon'], topic: bluey ? 'cartoons' : 'food' },
    })
  })
  await phone.route('**/api/ai/group', (route) => {
    const request = route.request().postDataJSON()
    groupings.push(request)
    route.fulfill({
      json: {
        assignments: request.stickers.map((s: { id: string; series: string }) =>
          s.series === 'Bluey' ? { id: s.id, name: 'Bluey', emoji: '🐶' } : { id: s.id, name: 'Food', emoji: '🍕' },
        ),
      },
    })
  })

  await phone.goto('/')
  const image = await phone.evaluate(async () => {
    const canvas = new OffscreenCanvas(60, 60)
    canvas.getContext('2d')!.fillRect(0, 0, 60, 60)
    return btoa(String.fromCharCode(...new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())))
  })
  const backup = {
    format: 'stickers-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: [],
    bookTitle: null,
    stickers: [1, 2, 3, 4].map((n) => ({ id: `s${n}`, width: 60, height: 60, createdAt: n, blob: { type: 'image/png', base64: image } })),
    book: [],
  }
  await phone.getByRole('button', { name: 'Settings' }).click()
  const phoneSheet = phone.getByRole('dialog', { name: 'Settings' })
  await phoneSheet.getByTestId('backup-input').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await phoneSheet.getByRole('button', { name: 'Restore' }).click()

  const folders = phone.getByRole('list', { name: 'Folders' })
  await expect(folders.getByRole('button', { name: 'Bluey, 3 stickers' })).toBeVisible({ timeout: 20_000 })
  await expect(folders.getByRole('button', { name: 'Food, 1 sticker' })).toBeVisible()
  // All four went to the AI together, as one batch.
  expect(groupings).toHaveLength(1)
  expect(groupings[0].stickers).toHaveLength(4)

  // Moving one by hand into an AI folder sticks.
  await folders.getByRole('button', { name: 'Food, 1 sticker' }).click()
  await phone.getByRole('dialog', { name: 'Food' }).getByRole('button', { name: 'Open sticker' }).click()
  const detail = phone.getByRole('dialog', { name: 'Sticker', exact: true })
  await detail.getByRole('button', { name: /Food/ }).click()
  await phone.getByRole('group', { name: 'Your folders' }).getByRole('button', { name: '🐶 Bluey' }).click()
  await expect(detail.getByText('your pick')).toBeVisible()
  await phone.goBack()
  await phone.goBack()
  // Just the one folder now, so no "All stickers" either.
  await expect(folders.getByRole('button')).toHaveCount(1)
  await expect(folders.getByRole('button', { name: 'Bluey, 4 stickers' })).toBeVisible()

  // Sorting everything again leaves the hand-placed one out.
  await phone.getByRole('button', { name: 'Settings' }).click()
  await phoneSheet.getByRole('button', { name: 'Sort everything again' }).click()
  await expect(phone.getByText('Sorted into new folders!')).toBeVisible()
  expect(groupings).toHaveLength(2)
  const pizza = groupings[0].stickers.find((s) => !s.series)!.id
  expect(groupings[1].stickers.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3', 's4'].filter((id) => id !== pizza))
  expect(groupings[1].folders.map((f) => f.name)).toEqual(['Bluey'])
  await expect(phoneSheet.getByText(/^Synced at /)).toBeVisible({ timeout: 15_000 })
  await phoneSheet.getByRole('button', { name: 'Close' }).click()

  // The laptop's server has no AI, but it gets the folders with the stickers.
  await laptop.goto('/')
  const laptopFolders = laptop.getByRole('list', { name: 'Folders' })
  await expect(laptopFolders.getByRole('button', { name: 'Bluey, 4 stickers' })).toBeVisible({ timeout: 15_000 })
  await laptop.getByRole('button', { name: 'Settings' }).click()
  await expect(laptop.getByRole('dialog', { name: 'Settings' }).getByText(E2E_EMAIL)).toBeVisible()
  await expect(laptop.getByRole('switch', { name: 'AI folders' })).toHaveCount(0)
})
