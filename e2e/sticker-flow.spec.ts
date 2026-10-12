import { readFile } from 'node:fs/promises'
import { devices, expect, test, type Page } from '@playwright/test'

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

test.describe('coloring book', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('stickers.removeBackground', 'off'))
  })

  /** Makes a sticker from the sun picture and opens its coloring page. */
  async function openColoringPage(page: Page) {
    await page.goto('/')
    await openPicture(page)
    await drawLoop(page)
    await page.getByRole('button', { name: 'Cut sticker' }).click()
    await page.getByRole('dialog', { name: 'Sticker preview' }).getByRole('button', { name: 'Add to collection' }).click()
    await expect(page.getByText('Added to your collection!')).toBeVisible()
    await page.getByRole('button', { name: 'Open sticker' }).click()
    await page.getByRole('dialog', { name: 'Sticker' }).getByRole('button', { name: 'Color' }).click()
    return page.getByRole('dialog', { name: 'Coloring page' })
  }

  test('draw a page with AI, and switch to another model when one refuses', async ({ page }) => {
    // What the AI sends back: a line drawing, slightly grey and soft like a real one.
    const drawing = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 1024
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fbfbfb'
      ctx.fillRect(0, 0, 1024, 1024)
      ctx.strokeStyle = '#141414'
      ctx.lineWidth = 9
      ctx.beginPath()
      ctx.arc(512, 512, 300, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = '#dddddd' // light shading the page should drop
      ctx.fillRect(450, 450, 120, 120)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const openai: { auth: string | null; body: string }[] = []
    await page.route('https://api.openai.com/v1/images/edits', async (route) => {
      openai.push({ auth: route.request().headers()['authorization'] ?? null, body: route.request().postData() ?? '' })
      const [status, message] =
        openai.length === 1 ? [401, 'Incorrect API key provided'] : [400, 'Your request was rejected as a result of our safety system.']
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { message } }) })
    })
    const google: { key: string | null; body: string }[] = []
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      google.push({ key: route.request().headers()['x-goog-api-key'] ?? null, body: route.request().postData() ?? '' })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: drawing } }] } }] }),
      })
    })

    const studio = await openColoringPage(page)
    // AI is the default; until it has drawn, the free drawing is only a preview.
    await expect(studio.getByRole('radio', { name: '✨ AI' })).toHaveAttribute('aria-checked', 'true')
    await expect(studio.getByRole('button', { name: 'Add to book' })).toBeDisabled()

    await studio.getByRole('button', { name: 'Set up AI drawing' }).click()
    const sheet = page.getByRole('dialog', { name: 'AI drawing settings' })
    await expect(sheet.getByRole('radio', { name: /GPT Image/ })).toHaveAttribute('aria-checked', 'true')
    await sheet.getByLabel('OpenAI API key').fill('sk-wrong')
    await sheet.getByRole('radio', { name: 'Draft' }).click()
    await expect(sheet.getByRole('radio', { name: /GPT Image/ })).toContainText('about $0.013 a page')
    await sheet.getByRole('button', { name: 'Save' }).click()

    await studio.getByRole('button', { name: 'Draw with AI' }).click()
    await expect(studio.getByRole('alert')).toHaveText('OpenAI rejected the API key. Check it in AI settings.')
    expect(openai[0].auth).toBe('Bearer sk-wrong')

    await studio.getByRole('button', { name: 'AI settings' }).click()
    await sheet.getByLabel('OpenAI API key').fill('sk-right')
    await sheet.getByRole('button', { name: 'Save' }).click()
    await studio.getByRole('button', { name: 'Draw with AI' }).click()

    // OpenAI refuses this one; with no other model set up yet, the page offers to set one up.
    await expect(studio.getByRole('alert')).toHaveText('OpenAI declined to draw this sticker.')
    expect(openai[1].auth).toBe('Bearer sk-right')
    expect(openai[1].body).toContain('name="quality"\r\n\r\nlow')
    await studio.getByRole('button', { name: 'Set up another model' }).click()
    await sheet.getByRole('radio', { name: /Nano Banana 2/ }).click()
    await sheet.getByLabel('Google API key').fill('AIza-test')
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(studio.getByText('Nano Banana 2 by Google, about $0.067 a page')).toBeVisible()
    await studio.getByRole('button', { name: 'Draw with AI' }).click()

    const preview = studio.getByTestId('coloring-page')
    await expect(preview).toHaveAttribute('data-engine', 'ai', { timeout: 20_000 })
    await expect(studio.getByRole('button', { name: 'Add to book' })).toBeEnabled()
    expect(google[0].key).toBe('AIza-test')
    expect(google[0].body).toContain('coloring book')

    // The drawing fills the page as crisp black lines; the grey shading is gone.
    const sheetPixels = await preview.evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const at = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[0]
      let leftEdge = -1
      for (let x = 0; x < canvas.width; x++) if (at(x, 1122) < 60) { leftEdge = x; break }
      return { center: at(874, 1122), leftEdge }
    })
    expect(sheetPixels.center).toBe(255)
    expect(sheetPixels.leftEdge).toBeGreaterThan(130)
    expect(sheetPixels.leftEdge).toBeLessThan(200)

    // Changing the detail level needs a new drawing, which costs money, so it waits to be asked.
    await studio.getByRole('radio', { name: 'Simple' }).click()
    await expect(studio.getByRole('button', { name: 'Draw with AI' })).toBeVisible()
    await studio.getByRole('radio', { name: 'Medium' }).click()
    await expect(preview).toHaveAttribute('data-engine', 'ai')
    expect(google).toHaveLength(1)

    await studio.getByRole('button', { name: 'Add to book' }).click()
    await expect(page.getByText('Added to your coloring book!')).toBeVisible()
  })

  test('a vector model draws SVG, rendered sharp at print size', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem(
        'stickers.ai',
        JSON.stringify({ engine: 'quiver', keys: { openai: '', google: '', fal: '', quiver: 'qv-test' }, models: {}, quality: 'medium' }),
      ),
    )
    // Like real generated SVG: only a viewBox, no width or height.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="80" fill="none" stroke="#000" stroke-width="2"/></svg>'
    let body = ''
    await page.route('https://api.quiver.ai/v1/svgs/generations', async (route) => {
      body = route.request().postData() ?? ''
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ svg, mime_type: 'image/svg+xml' }] }) })
    })

    const studio = await openColoringPage(page)
    await expect(studio.getByText('Arrow 2 (vector) by QuiverAI')).toBeVisible()
    await studio.getByRole('button', { name: 'Draw with AI' }).click()
    const preview = studio.getByTestId('coloring-page')
    await expect(preview).toHaveAttribute('data-engine', 'ai', { timeout: 20_000 })
    expect(JSON.parse(body)).toMatchObject({ model: 'arrow-2', n: 1 })

    // The circle fills the drawing area: its left edge sits near the page margin, and the line is
    // solid black with only a pixel or so of soft edge.
    const row = await preview.evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 1122, 400, 1)
      const values = Array.from({ length: 400 }, (_, x) => data[x * 4])
      return { first: values.findIndex((v) => v < 128), solid: values.filter((v) => v < 10).length, soft: values.filter((v) => v >= 10 && v < 245).length }
    })
    expect(row.first).toBeGreaterThan(130)
    expect(row.first).toBeLessThan(200)
    expect(row.solid).toBeGreaterThan(8)
    expect(row.soft).toBeLessThanOrEqual(4)
  })

  test('turn a sticker into an A5 coloring page for free, add it to the book, and export the book', async ({ page }) => {
    const studio = await openColoringPage(page)
    await studio.getByRole('radio', { name: 'Free' }).click()
    const preview = studio.getByTestId('coloring-page')
    await expect(studio.getByRole('button', { name: 'Add to book' })).toBeEnabled({ timeout: 20_000 })

    // The page is A5 at 300 dpi: white paper with black lines around the sun.
    const sheet = await preview.evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let dark = 0
      let colored = 0
      // Leave out the colour guide in the bottom-right corner.
      for (let y = 0; y < canvas.height * 0.85; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4
          if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) dark++
          else if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 40) colored++
        }
      }
      return { width: img.naturalWidth, height: img.naturalHeight, dark: dark / (canvas.width * canvas.height), colored }
    })
    expect(sheet.width).toBe(1748)
    expect(sheet.height).toBe(2480)
    expect(sheet.dark).toBeGreaterThan(0.002)
    expect(sheet.dark).toBeLessThan(0.1)
    expect(sheet.colored).toBe(0)

    await studio.getByRole('radio', { name: 'Simple' }).click()
    await expect(studio.getByRole('radio', { name: 'Simple' })).toHaveAttribute('aria-checked', 'true')
    await expect(studio.getByRole('button', { name: 'Add to book' })).toBeEnabled({ timeout: 20_000 })

    const single = page.waitForEvent('download')
    await studio.getByRole('button', { name: 'PDF' }).click()
    const singlePdf = await readFile((await (await single).path())!, 'latin1')
    expect(singlePdf.startsWith('%PDF-1.4')).toBe(true)
    expect(singlePdf).toContain('/Count 1')
    expect(singlePdf).toContain('/MediaBox [0 0 419.53 595.28]')

    await studio.getByRole('button', { name: 'Add to book' }).click()
    await expect(page.getByText('Added to your coloring book!')).toBeVisible()
    await studio.getByRole('button', { name: 'Open book' }).click()

    const book = page.getByRole('dialog', { name: 'Coloring book' })
    await expect(book.getByRole('img', { name: 'Page 1' })).toBeVisible()
    await expect(book.getByTestId('book-cover')).toBeVisible({ timeout: 20_000 })
    await book.getByLabel('Title').fill('Sunny Days')

    const download = page.waitForEvent('download')
    await book.getByRole('button', { name: 'Save PDF' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('sunny-days.pdf')
    const pdf = await readFile((await file.path())!, 'latin1')
    // A colour cover (JPEG) and one greyscale page.
    expect(pdf).toContain('/Count 2')
    expect(pdf).toContain('/DCTDecode')
    expect(pdf).toContain('/DeviceGray')

    // The book is kept, and the home screen links to it.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Coloring book, 1 pages' })).toBeVisible()
    await page.getByRole('button', { name: 'Coloring book, 1 pages' }).click()
    await book.getByRole('button', { name: 'Remove page 1' }).click()
    await book.getByRole('button', { name: 'Really remove page 1?' }).click()
    await expect(book.getByText('No pages yet')).toBeVisible()
  })
})

test('back up a collection and restore it on another device', async ({ page, browser }) => {
  await seedVersion1(page, ['dogs', 'dogs', 'food'])
  await page.goto('/')
  const folders = page.getByRole('list', { name: 'Folders' })
  await folders.getByRole('button', { name: 'Dogs, 2 stickers' }).click()
  const folder = page.getByRole('dialog', { name: 'Dogs' })
  await folder.getByRole('radio', { name: 'Mint' }).click()
  await page.goBack()

  await page.getByRole('button', { name: 'Sync and backup' }).click()
  const sheet = page.getByRole('dialog', { name: 'Sync and backup' })
  await expect(sheet.getByText(/^3 stickers · \d+ KB$/)).toBeVisible()
  const download = page.waitForEvent('download')
  await sheet.getByRole('button', { name: 'Download backup' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^stickers-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const path = (await file.path())!

  // A fresh browser profile stands in for the new device.
  const other = await (await browser.newContext({ ...devices['Pixel 7'], baseURL: test.info().project.use.baseURL })).newPage()
  await other.goto('/')
  await expect(other.getByText('Your sticker book is empty')).toBeVisible()
  await other.getByRole('button', { name: 'Sync and backup' }).click()
  const otherSheet = other.getByRole('dialog', { name: 'Sync and backup' })
  await otherSheet.getByTestId('backup-input').setInputFiles(path)
  await expect(otherSheet.getByText(/This backup has 3 stickers/)).toBeVisible()
  await otherSheet.getByRole('button', { name: 'Restore' }).click()

  // The app reloads with everything in place, folder colour included.
  const otherFolders = other.getByRole('list', { name: 'Folders' })
  await expect(otherFolders.getByRole('button', { name: 'All stickers, 3 stickers' })).toBeVisible({ timeout: 10_000 })
  await otherFolders.getByRole('button', { name: 'Dogs, 2 stickers' }).click()
  await expect(other.getByRole('dialog', { name: 'Dogs' }).getByRole('radio', { name: 'Mint' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await other.context().close()

  // A file that isn't a backup is turned away.
  await sheet.getByTestId('backup-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByText("That file isn't a Stickers backup")).toBeVisible()
})
