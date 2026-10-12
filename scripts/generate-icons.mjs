// Renders the PWA icons in public/ from the SVG sources. Run with `npm run icons`.
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

const tile = await readFile(new URL('../public/favicon.svg', import.meta.url))
const fullBleed = await readFile(new URL('./icon-maskable.svg', import.meta.url))

const render = (svg, size, name) =>
  sharp(svg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/${name}`, import.meta.url).pathname)

await Promise.all([
  render(tile, 64, 'pwa-64x64.png'),
  render(tile, 192, 'pwa-192x192.png'),
  render(tile, 512, 'pwa-512x512.png'),
  render(fullBleed, 512, 'maskable-icon-512x512.png'),
  render(fullBleed, 180, 'apple-touch-icon-180x180.png'),
])
console.log('Icons written to public/')
