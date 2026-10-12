import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

const SKY = [0x7c, 0xc6, 0xff]

/** A sky-blue picture with a yellow sun in the middle, as PNG bytes. */
async function makePicture(page: Page) {
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
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

async function openPicture(page: Page) {
  await page.getByTestId('file-input').setInputFiles({
    name: 'sun.png',
    mimeType: 'image/png',
    buffer: await makePicture(page),
  })
  await expect(page.getByRole('heading', { name: 'Circle your sticker' })).toBeVisible()
}

/** Drags a circle of `radius` (fraction of the canvas' shorter side) around the canvas center. */
async function drawLoop(page: Page, radius = 0.3) {
  const box = (await page.getByTestId('lasso-canvas').boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const r = Math.min(box.width, box.height) * radius
  await page.mouse.move(cx + r, cy)
  await page.mouse.down()
  for (let i = 1; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  await page.mouse.up()
}

/** Reads back the alpha of a saved sticker's center and corner pixels. */
async function stickerAlpha(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const alpha = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[3]
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      center: alpha(img.naturalWidth >> 1, img.naturalHeight >> 1),
      corner: alpha(0, 0),
    }
  })
}

/** Fraction of a sticker's visible pixels that are sky blue, i.e. background that wasn't removed. */
async function skyFraction(page: Page) {
  return page.getByRole('img', { name: 'Sticker preview' }).evaluate(async (img: HTMLImageElement, sky) => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let visible = 0
    let skyPixels = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue
      visible++
      if (Math.abs(data[i] - sky[0]) + Math.abs(data[i + 1] - sky[1]) + Math.abs(data[i + 2] - sky[2]) < 40) skyPixels++
    }
    return skyPixels / visible
  }, SKY)
}

test.describe('with background removal off', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('stickers.removeBackground', 'off'))
  })

  test('circle part of a picture, save it, and find it in the collection', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Your sticker book is empty')).toBeVisible()

    await openPicture(page)

    // A tiny scribble is rejected with a hint.
    await drawLoop(page, 0.02)
    await expect(page.getByText('Draw a bigger loop')).toBeVisible()

    await drawLoop(page)
    await expect(page.getByRole('heading', { name: 'Looks good?' })).toBeVisible()
    await page.getByRole('button', { name: 'Cut sticker' }).click()

    const preview = page.getByRole('dialog', { name: 'Sticker preview' })
    await expect(preview.getByRole('img', { name: 'Sticker preview' })).toBeVisible()
    await preview.getByRole('radio', { name: 'Thin' }).click()
    await expect(preview.getByRole('radio', { name: 'Thin' })).toHaveAttribute('aria-checked', 'true')
    await preview.getByRole('button', { name: 'Add to collection' }).click()

    await expect(page.getByText('Added to your collection!')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open sticker' })).toHaveCount(1)

    // The loop was a circle, so the sticker is opaque in the middle and transparent in the corners.
    const pixels = await stickerAlpha(page, '.grid-item img')
    expect(pixels.width).toBeGreaterThanOrEqual(512)
    expect(pixels.center).toBe(255)
    expect(pixels.corner).toBe(0)

    // Stickers survive a reload.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Open sticker' })).toHaveCount(1)

    await page.getByRole('button', { name: 'Open sticker' }).click()
    const detail = page.getByRole('dialog', { name: 'Sticker' })
    await detail.getByRole('button', { name: 'Delete' }).click()
    await detail.getByRole('button', { name: 'Sure?' }).click()
    await expect(page.getByText('Your sticker book is empty')).toBeVisible()
  })

  test('pick an effect, keep it, change it later, and share it baked in', async ({ page }) => {
    await page.goto('/')
    await openPicture(page)
    await drawLoop(page)
    await page.getByRole('button', { name: 'Cut sticker' }).click()

    const preview = page.getByRole('dialog', { name: 'Sticker preview' })
    const effects = preview.getByRole('radiogroup', { name: 'Effect' })
    // New stickers start plain; every swatch previews the actual sticker.
    await expect(effects.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true')
    await expect(effects.locator('.effect-swatch img')).toHaveCount(7)
    await effects.getByRole('radio', { name: 'Holo' }).click()
    await expect(effects.getByRole('radio', { name: 'Holo' })).toHaveAttribute('aria-checked', 'true')
    await expect(preview.locator('.preview-sticker [data-effect="holo"] .sticker-art-layer').first()).toBeVisible()
    await preview.getByRole('button', { name: 'Add to collection' }).click()

    // Shown with its effect in the grid, and still there after a reload.
    await expect(page.locator('.grid-item [data-effect="holo"]')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('.grid-item [data-effect="holo"]')).toHaveCount(1)

    await page.getByRole('button', { name: 'Open sticker' }).click()
    const detail = page.getByRole('dialog', { name: 'Sticker' })
    await expect(detail.locator('.detail-sticker [data-effect="holo"]')).toBeVisible()

    // Saved images have the effect baked in, so they differ from the plain cut-out.
    const original = await page.locator('.detail-sticker img').evaluate(async (img: HTMLImageElement) => {
      const blob = await (await fetch(img.src)).blob()
      return new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(blob)
      })
    })
    const [download] = await Promise.all([page.waitForEvent('download'), detail.getByRole('button', { name: 'Save' }).click()])
    const saved = await readFile(await download.path())
    expect(saved.subarray(1, 4).toString()).toBe('PNG')
    expect(saved.toString('base64')).not.toBe(original)

    // The effect can be changed afterwards, and that sticks too.
    await detail.getByRole('button', { name: /Holo/ }).click()
    const picker = detail.getByRole('dialog', { name: 'Choose effect' })
    await picker.getByRole('radio', { name: 'Chrome' }).click()
    await picker.getByRole('button', { name: 'Done' }).click()
    await expect(detail.locator('.detail-sticker [data-effect="chrome"]')).toBeVisible()
    await page.reload()
    await expect(page.locator('.grid-item [data-effect="chrome"]')).toHaveCount(1)
  })

  test('whole picture option and the back button', async ({ page }) => {
    await page.goto('/')
    await openPicture(page)

    // Browser back closes the editor.
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Circle your sticker' })).toBeHidden()

    await openPicture(page)
    await page.getByRole('button', { name: 'Use whole picture' }).click()
    const preview = page.getByRole('dialog', { name: 'Sticker preview' })
    await expect(preview.getByRole('img', { name: 'Sticker preview' })).toBeVisible()

    // Back from the preview returns to the editor, not the collection.
    await page.goBack()
    await expect(preview).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Circle your sticker' })).toBeVisible()
  })
})

test('background removal keeps the subject and drops the background', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await openPicture(page)
  // A loose loop: plenty of sky around the sun.
  await drawLoop(page, 0.42)
  await page.getByRole('button', { name: 'Cut sticker' }).click()

  const preview = page.getByRole('dialog', { name: 'Sticker preview' })
  const removeBg = preview.getByRole('switch', { name: 'Remove background' })
  await expect(removeBg).toHaveAttribute('aria-checked', 'true')
  await expect(preview.getByRole('img', { name: 'Sticker preview' })).toBeVisible({ timeout: 150_000 })
  expect(await skyFraction(page)).toBeLessThan(0.01)

  // Turning it off gives the plain loop cut, sky and all.
  await removeBg.click()
  await expect(removeBg).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => skyFraction(page)).toBeGreaterThan(0.2)

  // Turning it back on reuses the earlier result instead of running the model again.
  await removeBg.click()
  await expect.poll(() => skyFraction(page), { timeout: 5_000 }).toBeLessThan(0.01)
})

test('stickers get sorted into topics, and can be moved by hand', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => localStorage.setItem('stickers.removeBackground', 'off'))
  await page.goto('/')
  await openPicture(page)
  await drawLoop(page)
  await page.getByRole('button', { name: 'Cut sticker' }).click()
  await page.getByRole('dialog', { name: 'Sticker preview' }).getByRole('button', { name: 'Add to collection' }).click()

  // The on-device analysis files it under some topic in the background.
  await page.getByRole('button', { name: 'Open sticker' }).click()
  const detail = page.getByRole('dialog', { name: 'Sticker' })
  const pill = detail.locator('.topic-pill')
  await expect(pill).not.toContainText('Sorting', { timeout: 60_000 })

  await pill.click()
  await detail.getByRole('dialog', { name: 'Move to topic' }).getByRole('button', { name: /Music/ }).click()
  await expect(pill).toContainText('Music')
  await expect(pill).toContainText('your pick')

  // The choice is saved.
  await page.reload()
  await page.getByRole('button', { name: 'Open sticker' }).click()
  await expect(page.locator('.topic-pill')).toContainText('Music')

  // And can be handed back to the app.
  await page.locator('.topic-pill').click()
  await page.getByRole('button', { name: 'Let the app decide' }).click()
  await expect(page.locator('.topic-pill')).not.toContainText('your pick')
})

/** Before any app code runs, saves stickers filed under `topics` the way version 1 of the app did. */
async function seedVersion1(page: Page, topics: string[]) {
  // A blank page on the app's origin, so the app doesn't open (and upgrade) the database first.
  await page.route('**/seed', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }),
  )
  await page.goto('/seed')
  await page.evaluate(async (topics) => {
    const fills = ['#ff5a5f', '#ffd23f', '#3ec1d3', '#7a4dff']
    const blobs = await Promise.all(
      topics.map((_, i) => {
        const canvas = new OffscreenCanvas(256, 256)
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = fills[i % fills.length]
        ctx.beginPath()
        ctx.arc(128, 128, 100, 0, Math.PI * 2)
        ctx.fill()
        return canvas.convertToBlob({ type: 'image/png' })
      }),
    )
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('stickers', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('stickers', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('stickers', 'readwrite')
        topics.forEach((topic, i) =>
          tx.objectStore('stickers').put({ id: `seed-${i}`, blob: blobs[i], width: 256, height: 256, createdAt: 1000 + i, topic }),
        )
        tx.oncomplete = () => {
          db.close()
          resolve(null)
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, topics)
}

test('stickers from before folders show up in folders that fan out, open and change colour', async ({ page }) => {
  await seedVersion1(page, ['dogs', 'dogs', 'food', 'music'])
  await page.goto('/')

  const folders = page.getByRole('list', { name: 'Folders' })
  await expect(folders.getByRole('button')).toHaveCount(4)
  await expect(folders.getByRole('button', { name: 'All stickers, 4 stickers' })).toBeVisible()
  await expect(folders.getByRole('button', { name: 'Food & drinks, 1 sticker' })).toBeVisible()
  const dogs = folders.getByRole('button', { name: 'Dogs, 2 stickers' })

  // Pressing a folder pulls its stickers out to the right; letting go tucks them back in.
  const front = dogs.locator('.folder-sticker').first()
  const tucked = (await front.boundingBox())!.x
  await dogs.dispatchEvent('pointerdown')
  await expect.poll(async () => (await front.boundingBox())!.x - tucked).toBeGreaterThan(40)
  await dogs.dispatchEvent('pointerup')
  await expect.poll(async () => Math.abs((await front.boundingBox())!.x - tucked)).toBeLessThan(2)

  await dogs.click()
  const folder = page.getByRole('dialog', { name: 'Dogs' })
  await expect(folder.getByRole('button', { name: 'Open sticker' })).toHaveCount(2)

  await folder.getByRole('radio', { name: 'Mint' }).click()
  await expect(folder.getByRole('radio', { name: 'Mint' })).toHaveAttribute('aria-checked', 'true')

  // Stickers open on top of the folder; back returns to the folder, then to the collection.
  await folder.getByRole('button', { name: 'Open sticker' }).first().click()
  const detail = page.getByRole('dialog', { name: 'Sticker', exact: true })
  await expect(detail).toBeVisible()
  await page.goBack()
  await expect(detail).toBeHidden()
  await expect(folder).toBeVisible()
  await page.goBack()
  await expect(folder).toBeHidden()
  await expect(dogs).toHaveAttribute('data-color', 'mint')

  // The colour is saved with the collection.
  await page.reload()
  await expect(dogs).toHaveAttribute('data-color', 'mint')
  await folders.getByRole('button', { name: 'All stickers, 4 stickers' }).click()
  const all = page.getByRole('dialog', { name: 'All stickers' })
  await expect(all.getByRole('button', { name: 'Open sticker' })).toHaveCount(4)
})
