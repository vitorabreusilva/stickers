import { SHARE_CACHE, SHARE_ENTRY, SHARED_PARAM } from './share-inbox'

/** Returns the first image in the system clipboard. Must be called from a user gesture. */
export async function readClipboardImage(): Promise<Blob | null> {
  const items = await navigator.clipboard.read()
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (type) return item.getType(type)
  }
  return null
}

export const canReadClipboard = () => typeof navigator.clipboard?.read === 'function'

export const canCopyImage = () =>
  typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function'

export async function copyImage(blob: Blob) {
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

export function canShareFile(file: File) {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
}

/** Opens the native share sheet. Resolves false if the user dismissed it. */
export async function shareFile(file: File): Promise<boolean> {
  try {
    await navigator.share({ files: [file] })
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false
    throw err
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function firstImageFile(list: FileList | DataTransferItemList | null | undefined): File | null {
  if (!list) return null
  const entries: (File | DataTransferItem)[] = Array.from(list as ArrayLike<File | DataTransferItem>)
  for (const entry of entries) {
    const file = entry instanceof File ? entry : entry.kind === 'file' ? entry.getAsFile() : null
    if (file && file.type.startsWith('image/')) return file
  }
  return null
}

/**
 * If the app was opened from the share sheet, removes the marker from the URL and returns the
 * shared image ('none' when something without an image, like a link, was shared).
 */
export async function takeSharedImage(): Promise<Blob | 'none' | null> {
  const url = new URL(location.href)
  const marker = url.searchParams.get(SHARED_PARAM)
  if (!marker) return null
  url.searchParams.delete(SHARED_PARAM)
  history.replaceState(history.state, '', url)
  if (!('caches' in window)) return 'none'

  const cache = await caches.open(SHARE_CACHE)
  const key = new URL(SHARE_ENTRY, new URL(import.meta.env.BASE_URL, location.origin)).href
  const response = await cache.match(key)
  if (!response) return 'none'
  await cache.delete(key)
  return response.blob()
}
