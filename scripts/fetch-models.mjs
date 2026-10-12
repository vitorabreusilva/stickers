// Downloads the on-device models listed in models.json into public/models/ (they're too big for
// git). Runs before `npm run dev` and `npm run build`; files already present and intact are skipped.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const models = JSON.parse(await readFile(new URL('./models.json', import.meta.url), 'utf8'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

await mkdir('public/models', { recursive: true })
for (const { file, url, sha256: expected } of Object.values(models)) {
  const path = `public/models/${file}`
  try {
    if (sha256(await readFile(path)) === expected) continue
  } catch {
    // Not downloaded yet.
  }
  console.log(`Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== expected) throw new Error(`Checksum mismatch for ${file}`)
  await writeFile(path, bytes)
  console.log(`Saved ${path} (${(bytes.length / 1e6).toFixed(1)} MB)`)
}
