// Downloads the background-removal model into public/models/ (it's too big to keep in git).
// Runs automatically before `npm run dev` and `npm run build`; does nothing if the file is already there.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

// MediaPipe Interactive Segmenter v2 ("Magic Touch"), int8, version 1.
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task'
const SHA256 = '38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03'
// Keep in sync with CUTOUT_MODEL in vite.config.ts.
const MODEL_FILE = 'public/models/magic-touch-v2-int8-1.task'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

try {
  if (sha256(await readFile(MODEL_FILE)) === SHA256) process.exit(0)
} catch {
  // Not downloaded yet.
}

console.log(`Downloading cutout model from ${MODEL_URL}`)
const response = await fetch(MODEL_URL)
if (!response.ok) throw new Error(`Model download failed: ${response.status} ${response.statusText}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (sha256(bytes) !== SHA256) throw new Error('Model download is corrupt (checksum mismatch)')

await mkdir('public/models', { recursive: true })
await writeFile(MODEL_FILE, bytes)
console.log(`Saved ${MODEL_FILE} (${(bytes.length / 1e6).toFixed(1)} MB)`)
