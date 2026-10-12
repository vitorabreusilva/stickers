import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { del, get, put } from '@vercel/blob'

/** Where pictures live. Paths are always built by the server from the user's id, never taken from a request. */
export interface ImageStore {
  put(path: string, body: ArrayBuffer, contentType: string): Promise<void>
  get(path: string): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>; contentType: string } | null>
  delete(paths: string[]): Promise<void>
}

/** A private Vercel Blob store: nothing is reachable without going through our signed-in routes. */
const vercelBlob: ImageStore = {
  async put(path, body, contentType) {
    await put(path, body, { access: 'private', contentType, allowOverwrite: true, addRandomSuffix: false })
  },
  async get(path) {
    const result = await get(path, { access: 'private' })
    if (!result || result.statusCode !== 200) return null
    return { body: result.stream, contentType: result.blob.contentType }
  },
  async delete(paths) {
    if (paths.length) await del(paths)
  },
}

/** Files on disk, for local development without a Blob store. */
function folderStore(root: string): ImageStore {
  const file = (path: string) => {
    const full = resolve(root, path)
    if (!full.startsWith(resolve(root) + '/')) throw new Error('Bad image path')
    return full
  }
  return {
    async put(path, body, contentType) {
      await mkdir(dirname(file(path)), { recursive: true })
      await writeFile(file(path), new Uint8Array(body))
      await writeFile(`${file(path)}.type`, contentType)
    },
    async get(path) {
      try {
        const [body, contentType] = await Promise.all([readFile(file(path)), readFile(`${file(path)}.type`, 'utf8')])
        return { body: new Uint8Array(body), contentType }
      } catch {
        return null
      }
    },
    async delete(paths) {
      await Promise.all(paths.flatMap((p) => [rm(file(p), { force: true }), rm(`${file(p)}.type`, { force: true })]))
    },
  }
}

let store: ImageStore | undefined

export function getImageStore(): ImageStore {
  if (store) return store
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) store = vercelBlob
  else if (process.env.VERCEL) throw new Error('No Blob store is connected to this Vercel project')
  else store = folderStore(join(process.cwd(), '.data', 'images'))
  return store
}

/** Lets tests swap in their own store. */
export function setImageStore(next: ImageStore | undefined) {
  store = next
}
