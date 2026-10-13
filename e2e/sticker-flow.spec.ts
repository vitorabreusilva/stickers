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
    const pixels = await stickerAlpha(page, '.latest-item img')
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

    // Shown with its effect among the latest stickers, and still there after a reload.
    await expect(page.locator('.latest-item [data-effect="holo"]')).toHaveCount(1)
    await page.reload()
    await expect(page.locator('.latest-item [data-effect="holo"]')).toHaveCount(1)

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
    await expect(page.locator('.latest-item [data-effect="chrome"]')).toHaveCount(1)
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

test('stickers from before folders show up in folders that fan out, open, change colour and get renamed', async ({ page }) => {
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

  // The folder's header is its name and size; colour and name are in its settings.
  await expect(folder.getByText('2 stickers')).toBeVisible()
  await expect(folder.getByRole('radio', { name: 'Mint' })).toHaveCount(0)
  await folder.getByRole('button', { name: 'Folder settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Folder settings' })
  await settings.getByRole('radio', { name: 'Mint' }).click()
  await expect(settings.getByRole('radio', { name: 'Mint' })).toHaveAttribute('aria-checked', 'true')
  // Sorting again needs the AI, which needs signing in.
  await expect(settings.getByRole('button', { name: 'Sort again with AI' })).toBeDisabled()
  await settings.getByRole('button', { name: 'Close' }).click()
  await expect(settings).toBeHidden()

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

  // Right-clicking a folder opens its settings too; a new name sticks, and can be undone.
  await dogs.click({ button: 'right' })
  await expect(settings).toBeVisible()
  await settings.getByLabel('Name').fill('Good boys')
  await settings.getByLabel('Name').press('Enter')
  await expect(settings).toBeHidden()
  const goodBoys = folders.getByRole('button', { name: 'Good boys, 2 stickers' })
  await expect(goodBoys).toBeVisible()
  // Saving is quick but not instant; don't reload before it's written.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | undefined>((resolve, reject) => {
            const open = indexedDB.open('stickers')
            open.onerror = () => reject(open.error)
            open.onsuccess = () => {
              const get = open.result.transaction('folders').objectStore('folders').get('dogs')
              get.onsuccess = () => {
                resolve(get.result?.name)
                open.result.close()
              }
            }
          }),
      ),
    )
    .toBe('Good boys')

  // The colour and name are saved with the collection.
  await page.reload()
  await expect(goodBoys).toHaveAttribute('data-color', 'mint')
  await goodBoys.click({ button: 'right' })
  await settings.getByRole('button', { name: 'Use “Dogs”' }).click()
  await settings.getByRole('button', { name: 'Close' }).click()
  await expect(dogs).toBeVisible()

  // Latest has a way through to every sticker.
  await page.getByRole('button', { name: 'View all' }).click()
  await expect(page.getByRole('dialog', { name: 'All stickers' }).getByRole('button', { name: 'Open sticker' })).toHaveCount(4)
  await page.goBack()
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

    // With no books yet, the first page starts one.
    await studio.getByRole('button', { name: 'Add to book' }).click()
    await expect(page.getByText('Added to My Coloring Book!')).toBeVisible()
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
    await expect(page.getByText('Added to My Coloring Book!')).toBeVisible()
    await studio.getByRole('button', { name: 'Open book' }).click()

    // One page makes a whole booklet: the four sides of the cover, the page, and three blanks.
    const book = page.getByRole('dialog', { name: 'Coloring book' })
    await expect(book.getByRole('img', { name: 'Page 1', exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(book.getByTestId('book-cover')).toBeVisible({ timeout: 20_000 })
    await expect(book.getByText('8 pages to print')).toBeVisible()
    await expect(book.getByRole('img', { name: 'Page 4, blank' })).toBeVisible({ timeout: 20_000 })
    await expect(book.getByRole('img', { name: 'Back cover', exact: true })).toBeVisible({ timeout: 20_000 })
    await book.getByLabel('Title').fill('Sunny Days')

    // The cover is customized from its preview: colour, layout, or one sticker on a stamp, and then
    // the picture the sticker was cut from behind the title.
    await book.getByRole('button', { name: 'Customize cover' }).click()
    const coverViewer = page.getByRole('dialog', { name: 'Book preview' })
    const editor = coverViewer.getByRole('region', { name: 'Customize cover' })
    await editor.getByRole('radiogroup', { name: 'Cover colour' }).getByRole('radio', { name: 'Night' }).click()
    await editor.getByRole('radio', { name: 'Spotlight' }).click()
    await expect(editor.getByRole('radio', { name: 'Spotlight' })).toHaveAttribute('aria-checked', 'true')
    await expect(editor.getByRole('switch', { name: /original picture/ })).toHaveCount(0)
    await editor.getByRole('radio', { name: 'Stamp' }).click()
    await expect(editor.getByRole('radio', { name: 'Sticker for the cover' })).toHaveAttribute('aria-checked', 'true')
    const photo = editor.getByRole('switch', { name: /original picture/ })
    await expect(photo).toBeEnabled()
    const stampCover = await coverViewer.getByRole('img', { name: 'Cover' }).getAttribute('src')
    await photo.click()
    await expect(photo).toHaveAttribute('aria-checked', 'true')
    // The sky-blue picture now fills the cover, right down to its corners.
    await expect
      .poll(async () => {
        const img = coverViewer.getByRole('img', { name: 'Cover' })
        if ((await img.getAttribute('src')) === stampCover) return false
        const rgb = await img.evaluate(async (el: HTMLImageElement) => {
          await el.decode()
          const canvas = document.createElement('canvas')
          canvas.width = el.naturalWidth
          canvas.height = el.naturalHeight
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(el, 0, 0)
          return [...ctx.getImageData(4, canvas.height - 5, 1, 1).data.slice(0, 3)]
        })
        return rgb.every((v, i) => Math.abs(v - SKY[i]) < 24)
      }, { timeout: 20_000 })
      .toBe(true)
    await editor.getByRole('button', { name: 'Done' }).click()
    await expect(editor).toBeHidden()
    await page.goBack()
    await expect(coverViewer).toBeHidden()

    // The page has no "Colored by" line any more, but a page number at the outside of the foot.
    const pageArt = await book.getByRole('img', { name: 'Page 1', exact: true }).evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const dark = (x0: number, y0: number, x1: number, y1: number) => {
        const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
        let n = 0
        for (let i = 0; i < data.length; i += 4) if (data[i] < 128) n++
        return n
      }
      const { width: w, height: h } = canvas
      // Footer left of the colour guide, then the page number's corner (page 1 is a right-hand page).
      return { footer: dark(0, h * 0.88, w * 0.7, h * 0.93), folio: dark(w * 0.85, h * 0.95, w, h) }
    })
    expect(pageArt.footer).toBe(0)
    expect(pageArt.folio).toBeGreaterThan(0)

    // Leaf through it, one page at a time on a phone.
    await book.getByRole('button', { name: 'Preview', exact: true }).click()
    const viewer = page.getByRole('dialog', { name: 'Book preview' })
    await expect(viewer.getByText('Cover', { exact: true })).toBeVisible()
    await viewer.getByRole('button', { name: 'Next' }).click()
    await expect(viewer.getByText('Inside cover', { exact: true })).toBeVisible()
    await viewer.getByRole('button', { name: 'Next' }).click()
    await expect(viewer.getByRole('img', { name: 'Page 1' })).toBeVisible()
    await expect(viewer.getByText('3 / 8')).toBeVisible()
    await page.goBack()
    await expect(viewer).toBeHidden()

    await book.getByRole('button', { name: 'Print or save' }).click()
    const exportSheet = page.getByRole('dialog', { name: 'Print or save' })
    let download = page.waitForEvent('download')
    await exportSheet.getByRole('button', { name: /^Save PDF/ }).click()
    let file = await download
    expect(file.suggestedFilename()).toBe('sunny-days.pdf')
    let pdf = await readFile((await file.path())!, 'latin1')
    // Colour covers (JPEG), the page in colour for its colour guide, and greyscale for the rest.
    expect(pdf).toContain('/Count 8')
    expect(pdf.match(/\/DCTDecode/g)).toHaveLength(2)
    expect(pdf).toContain('/DeviceGray')
    expect(pdf.match(/\/MediaBox \[0 0 419\.53 595\.28\]/g)).toHaveLength(8)

    // The booklet: two pages on each side of two A4 sheets.
    await book.getByRole('button', { name: 'Print or save' }).click()
    download = page.waitForEvent('download')
    await exportSheet.getByRole('button', { name: /^Booklet PDF/ }).click()
    file = await download
    expect(file.suggestedFilename()).toBe('sunny-days-booklet.pdf')
    pdf = await readFile((await file.path())!, 'latin1')
    expect(pdf).toContain('/Count 4')
    expect(pdf.match(/\/MediaBox \[0 0 841\.89 595\.28\]/g)).toHaveLength(4)

    // The book is kept, on the home screen's shelf.
    await page.reload()
    const shelf = page.getByRole('list', { name: 'Coloring books' })
    await expect(shelf.getByRole('button', { name: 'Sunny Days, 1 page' })).toBeVisible()

    // A second book; new pages then ask which book they go in.
    await shelf.getByRole('button', { name: 'New book' }).click()
    await expect(book.getByLabel('Title')).toHaveValue('My Coloring Book')
    await book.getByLabel('Title').fill('Holiday')
    await expect(book.getByText('No pages yet')).toBeVisible()
    await page.goBack()
    await expect(shelf.getByRole('button', { name: 'Holiday, 0 pages' })).toBeVisible()

    await page.getByRole('button', { name: 'Open sticker' }).click()
    await page.getByRole('dialog', { name: 'Sticker' }).getByRole('button', { name: 'Color' }).click()
    await studio.getByRole('radio', { name: 'Free' }).click()
    await expect(studio.getByRole('button', { name: 'Add to book' })).toBeEnabled({ timeout: 20_000 })
    await studio.getByRole('button', { name: 'Add to book' }).click()
    const picker = page.getByRole('dialog', { name: 'Add to which book?' })
    await picker.getByRole('button', { name: /^Holiday/ }).click()
    await expect(page.getByText('Added to Holiday!')).toBeVisible()
    await studio.getByRole('button', { name: 'Open book' }).click()
    await expect(book.getByLabel('Title')).toHaveValue('Holiday')

    // Edit the page: leave out its colour guide, then move it to the first book.
    await book.getByRole('button', { name: 'Edit page 1' }).click()
    const pageSheet = page.getByRole('dialog', { name: 'Page 1' })
    const guide = pageSheet.getByRole('switch', { name: 'Color guide in the corner' })
    await expect(guide).toHaveAttribute('aria-checked', 'true')
    await guide.click()
    await expect(guide).toHaveAttribute('aria-checked', 'false')
    await pageSheet.getByRole('button', { name: /^Sunny Days/ }).click()
    await expect(page.getByText('Moved to Sunny Days')).toBeVisible()
    await expect(pageSheet).toBeHidden()
    await expect(book.getByText('No pages yet')).toBeVisible()

    // Deleting a book takes its pages with it.
    await book.getByRole('button', { name: 'Delete book' }).click()
    await book.getByRole('button', { name: 'Really delete this book?' }).click()
    await expect(page.getByText('Deleted Holiday')).toBeVisible()
    await page.goBack()
    await page.goBack()
    await expect(shelf.getByRole('listitem')).toHaveCount(2)

    // The moved page is the first book's second, without its colour guide.
    await shelf.getByRole('button', { name: 'Sunny Days, 2 pages' }).click()
    const guideInk = (name: string) =>
      book.getByRole('img', { name, exact: true }).evaluate(async (img: HTMLImageElement) => {
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const { width: w, height: h } = canvas
        const { data } = ctx.getImageData(w * 0.75, h * 0.86, w * 0.17, h * 0.07)
        let n = 0
        for (let i = 0; i < data.length; i += 4) if (Math.min(data[i], data[i + 1], data[i + 2]) < 200) n++
        return n
      })
    await expect(book.getByRole('img', { name: 'Page 2', exact: true })).toBeVisible({ timeout: 20_000 })
    expect(await guideInk('Page 1')).toBeGreaterThan(0)
    expect(await guideInk('Page 2')).toBe(0)

    // Drag the second page in front of the first.
    const pageIds = () => book.locator('[data-drag-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.dragId))
    const [firstId, secondId] = await pageIds()
    // Out from under the buttons docked at the bottom.
    await book.getByRole('button', { name: 'Preview page 2' }).evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const from = (await book.getByRole('button', { name: 'Preview page 2' }).boundingBox())!
    const to = (await book.getByRole('button', { name: 'Preview page 1' }).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 3)
    // Held first: on a touch screen a page is picked up with a long press.
    await page.mouse.down()
    await page.waitForTimeout(500)
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 3, { steps: 12 })
    await page.mouse.up()
    await expect.poll(pageIds).toEqual([secondId, firstId])
    await expect.poll(() => guideInk('Page 1'), { timeout: 20_000 }).toBe(0)
    // The order is kept.
    await page.reload()
    await shelf.getByRole('button', { name: 'Sunny Days, 2 pages' }).click()
    await expect.poll(pageIds, { timeout: 10_000 }).toEqual([secondId, firstId])
  })
})

test('back up a collection and restore it on another device', async ({ page, browser }) => {
  await seedVersion1(page, ['dogs', 'dogs', 'food'])
  await page.goto('/')
  const folders = page.getByRole('list', { name: 'Folders' })
  await folders.getByRole('button', { name: 'Dogs, 2 stickers' }).click({ button: 'right' })
  const folderSettings = page.getByRole('dialog', { name: 'Folder settings' })
  await folderSettings.getByRole('radio', { name: 'Mint' }).click()
  await folderSettings.getByLabel('Name').fill('Pups')
  await folderSettings.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Settings' }).click()
  const sheet = page.getByRole('dialog', { name: 'Settings' })
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
  await other.getByRole('button', { name: 'Settings' }).click()
  const otherSheet = other.getByRole('dialog', { name: 'Settings' })
  await otherSheet.getByTestId('backup-input').setInputFiles(path)
  await expect(otherSheet.getByText(/This backup has 3 stickers/)).toBeVisible()
  await otherSheet.getByRole('button', { name: 'Restore' }).click()

  // The app reloads with everything in place, folder colour and name included.
  const otherFolders = other.getByRole('list', { name: 'Folders' })
  await expect(otherFolders.getByRole('button', { name: 'All stickers, 3 stickers' })).toBeVisible({ timeout: 10_000 })
  await expect(otherFolders.getByRole('button', { name: 'Pups, 2 stickers' })).toHaveAttribute('data-color', 'mint')
  await other.context().close()

  // A file that isn't a backup is turned away.
  await sheet.getByTestId('backup-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByText("That file isn't a Stickers backup")).toBeVisible()
})
