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
  await phone.getByRole('button', { name: 'Sync and backup' }).click()
  const phoneSheet = phone.getByRole('dialog', { name: 'Sync and backup' })
  await expect(phoneSheet.getByText(E2E_EMAIL)).toBeVisible()
  await phoneSheet.getByRole('button', { name: 'Close' }).click()

  // Make a sticker the quick way: restore a one-sticker backup.
  await phone.getByRole('button', { name: 'Sync and backup' }).click()
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
  await phone.getByRole('button', { name: 'Sync and backup' }).click()
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
  const laptopSheet = laptop.getByRole('dialog', { name: 'Sync and backup' })

  await phone.getByRole('button', { name: 'Sync and backup' }).click()
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

  await laptop.getByRole('button', { name: 'Sync and backup' }).click()
  const laptopPull = pulled(laptop)
  await laptopSheet.getByRole('button', { name: 'Sync now' }).click()
  await laptopPull
  await laptopSheet.getByRole('button', { name: 'Close' }).click()
  await expect(laptop.getByRole('button', { name: 'Open sticker' })).toHaveCount(1)

  // Signing out keeps the stickers on the device.
  await laptop.getByRole('button', { name: 'Sync and backup' }).click()
  await laptopSheet.getByRole('button', { name: 'Sign out' }).click()
  await expect(laptopSheet.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await laptopSheet.getByRole('button', { name: 'Close' }).click()
  await expect(laptop.getByRole('button', { name: 'Open sticker' })).toHaveCount(1)
})
