import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('stickers.removeBackground', 'off'))
})

/** Opens an 800 × 600 sky-blue picture with a yellow sun in the middle in the editor. */
async function openPicture(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgb(124, 198, 255)'
    ctx.fillRect(0, 0, 800, 600)
    ctx.fillStyle = '#ffd23f'
    ctx.beginPath()
    ctx.arc(400, 300, 120, 0, Math.PI * 2)
    ctx.fill()
    return canvas.toDataURL('image/png')
  })
  await page.getByTestId('file-input').setInputFiles({
    name: 'sun.png',
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
  })
  await expect(page.getByRole('heading', { name: 'Circle your sticker' })).toBeVisible()
}

/** Size of an <img>, the alpha of its corner, and its centre pixel. */
async function pixels(page: Page, img: ReturnType<Page['getByRole']>) {
  return img.evaluate(async (el: HTMLImageElement) => {
    await el.decode()
    const canvas = document.createElement('canvas')
    canvas.width = el.naturalWidth
    canvas.height = el.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(el, 0, 0)
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
    const w = el.naturalWidth
    const h = el.naturalHeight
    return { width: w, height: h, corner: at(0, 0)[3], center: at(w >> 1, h >> 1) }
  })
}

test('frame a picture as a stamp, then see its original picture and sizes', async ({ page }) => {
  await page.goto('/')
  await openPicture(page)
  await page.getByRole('button', { name: 'Use whole picture' }).click()

  const preview = page.getByRole('dialog', { name: 'Sticker preview' })
  await expect(preview.getByRole('switch', { name: 'Remove background' })).toBeVisible()
  await preview.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Stamp' }).click()
  await expect(preview.getByRole('heading', { name: 'Your new stamp' })).toBeVisible()
  // A stamp keeps the whole picture, so there's no background to remove and no die-cut border.
  await expect(preview.getByRole('switch', { name: 'Remove background' })).toBeHidden()
  await expect(preview.getByRole('radiogroup', { name: 'Border' })).toBeHidden()

  // The picture sits whole inside a white frame whose corners are punched out by perforations.
  const stamp = await pixels(page, preview.getByRole('img', { name: 'Sticker preview' }))
  expect(stamp.width).toBeGreaterThan(stamp.height)
  expect(stamp.corner).toBe(0)
  expect(stamp.center.slice(0, 3)).toEqual([255, 210, 63])
  await preview.getByRole('button', { name: 'Add to collection' }).click()
  await expect(page.getByText('Stamp added to your collection!')).toBeVisible()

  await page.getByRole('button', { name: 'Open sticker' }).click()
  const detail = page.getByRole('dialog', { name: 'Stamp', exact: true })
  const facts = detail.getByRole('region', { name: 'About this sticker' })
  await expect(facts.getByText('Stamp', { exact: true })).toBeVisible()
  await expect(facts.getByText(`${stamp.width} × ${stamp.height} px`)).toBeVisible()
  await expect(facts.getByText('800 × 600 px')).toBeVisible()
  // It isn't in any coloring book yet.
  await expect(facts.getByText('In your coloring books')).toBeHidden()

  await facts.getByRole('button', { name: 'See the original picture' }).click()
  const viewer = page.getByRole('dialog', { name: 'Original picture' })
  const original = await pixels(page, viewer.getByRole('img'))
  expect([original.width, original.height]).toEqual([800, 600])
  // Exactly the picture that was opened: sky in the corner, sun in the middle.
  expect(original.center.slice(0, 3)).toEqual([255, 210, 63])
  const download = page.waitForEvent('download')
  await viewer.getByRole('button', { name: 'Save' }).click()
  expect((await download).suggestedFilename()).toMatch(/^original-.+\.png$/)
  await viewer.getByRole('button', { name: 'Close original picture' }).click()
  await expect(viewer).toBeHidden()
  await expect(detail).toBeVisible()
})

test('a sticker and its coloring pages lead to each other', async ({ page }) => {
  await page.goto('/')
  await openPicture(page)
  await page.getByRole('button', { name: 'Use whole picture' }).click()
  await page.getByRole('dialog', { name: 'Sticker preview' }).getByRole('button', { name: 'Add to collection' }).click()
  await expect(page.getByText('Added to your collection!')).toBeVisible()

  await page.getByRole('button', { name: 'Open sticker' }).click()
  const detail = page.getByRole('dialog', { name: 'Sticker', exact: true })
  await expect(detail.getByText('Die-cut sticker')).toBeVisible()
  await detail.getByRole('button', { name: 'Color' }).click()
  const studio = page.getByRole('dialog', { name: 'Coloring page' })
  await studio.getByRole('radio', { name: 'Free' }).click()
  await expect(studio.getByRole('button', { name: 'Add to book' })).toBeEnabled({ timeout: 20_000 })
  await studio.getByRole('button', { name: 'Add to book' }).click()
  await expect(page.getByText('Added to My Coloring Book!')).toBeVisible()
  await studio.getByRole('button', { name: 'Back' }).click()

  // The sticker lists the page made from it, and opens it.
  await expect(detail.getByText('In your coloring books')).toBeVisible()
  await detail.getByRole('button', { name: 'Open page 1 of My Coloring Book' }).click()
  const book = page.getByRole('dialog', { name: 'Coloring book' })
  await expect(book).toBeVisible()
  const pageSheet = page.getByRole('dialog', { name: 'Page 1' })
  await expect(pageSheet.getByText('Made from this sticker')).toBeVisible()

  // And the page leads back to its sticker.
  await pageSheet.getByRole('button', { name: 'Open sticker' }).click()
  const again = page.getByRole('dialog', { name: 'Sticker', exact: true }).last()
  await expect(again.getByRole('button', { name: 'Open page 1 of My Coloring Book' })).toBeVisible()

  // Once the sticker is deleted, the page still shows what it was made from.
  await again.getByRole('button', { name: 'Delete' }).click()
  await again.getByRole('button', { name: 'Sure?' }).click()
  await expect(pageSheet.getByText("It's no longer in your collection")).toBeVisible()
  await expect(pageSheet.getByRole('img', { name: 'The sticker this page was made from' })).toBeVisible()
  await expect(pageSheet.getByRole('button', { name: 'Open sticker' })).toBeHidden()
})
