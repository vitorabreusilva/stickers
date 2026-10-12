// The app's side of AI folders: asks our server to describe stickers and sort them into folders.
// Only when signed in, since the server uses the app's own keys.

import { api } from './account'
import { canvasToBlob, createCanvas } from './image'
import { parseStickerAi, type GroupReply, type GroupRequest, type StickerAi } from './smart-groups'

/** Stickers go to the model at most this big; plenty to tell what's in them. */
const DESCRIBE_SIZE = 512
const PREF_KEY = 'stickers.aiFolders'

/** `kind` 'key' means the server can't do AI folders at all, so there's no point asking again. */
export class AiFolderError extends Error {
  constructor(
    message: string,
    readonly kind: 'refused' | 'key' | 'other' = 'other',
  ) {
    super(message)
  }
}

/** Whether AI folders are turned on on this device (they are unless turned off). */
export function aiFoldersPreferred(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAiFoldersPreferred(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    // It's on again next time; fine.
  }
}

/** Whether the server can make AI folders for the signed-in person. */
export async function serverHasAiFolders(): Promise<boolean> {
  try {
    const response = await fetch(api('ai/providers'), { credentials: 'same-origin' })
    if (!response.ok) return false
    return ((await response.json()) as { folders?: boolean }).folders === true
  } catch {
    return false
  }
}

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { error?: string; kind?: AiFolderError['kind'] } | null
  const kind = body?.kind ?? (response.status === 401 || response.status === 403 || response.status === 409 ? 'key' : 'other')
  throw new AiFolderError(body?.error ?? `AI folders request failed (${response.status})`, kind)
}

async function shrink(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, DESCRIBE_SIZE / Math.max(bitmap.width, bitmap.height))
    const canvas = createCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
    const ctx = canvas.getContext('2d')!
    // On white, so transparent edges don't read as black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await canvasToBlob(canvas, 'image/jpeg')
  } finally {
    bitmap.close()
  }
}

/** What the AI says `sticker` shows. */
export async function describeSticker(sticker: Blob, signal?: AbortSignal): Promise<StickerAi> {
  const form = new FormData()
  form.append('image', await shrink(sticker), 'sticker.jpg')
  const response = await fetch(api('ai/describe'), { method: 'POST', body: form, credentials: 'same-origin', signal })
  if (!response.ok) return fail(response)
  const ai = parseStickerAi(await response.json())
  if (!ai) throw new AiFolderError('The AI sent back no description.')
  return ai
}

/** Which folder each of the request's stickers goes in. `total` is the size of the whole collection. */
export async function sortIntoFolders(request: GroupRequest, total: number, signal?: AbortSignal): Promise<GroupReply> {
  const response = await fetch(api('ai/group'), {
    method: 'POST',
    body: JSON.stringify({ ...request, total }),
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    signal,
  })
  if (!response.ok) return fail(response)
  const body = (await response.json()) as GroupReply
  if (!Array.isArray(body?.assignments)) throw new AiFolderError('The AI sent back no folders.')
  return body
}
