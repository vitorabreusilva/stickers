import { useCallback, useEffect, useRef, useState } from 'react'
import {
  collectionEvents,
  deleteSticker,
  listStickers,
  saveSticker,
  storeOriginal,
  updateSticker,
  type StickerRecord,
} from '../lib/db'

export interface Sticker extends StickerRecord {
  url: string
}

/** The sticker collection from IndexedDB, with object URLs ready for <img>. null while loading. */
export function useStickers() {
  const [stickers, setStickers] = useState<Sticker[] | null>(null)
  const urls = useRef(new Map<string, string>())

  const withUrl = useCallback((record: StickerRecord): Sticker => {
    let url = urls.current.get(record.id)
    if (!url) {
      url = URL.createObjectURL(record.blob)
      urls.current.set(record.id, url)
    }
    return { ...record, url }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listStickers()
        .then((records) => {
          if (cancelled) return
          // Let go of pictures for stickers deleted on another device.
          const ids = new Set(records.map((r) => r.id))
          urls.current.forEach((url, id) => {
            if (!ids.has(id)) {
              urls.current.delete(id)
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }
          })
          setStickers(records.map(withUrl))
        })
        .catch((err) => {
          console.error('Could not load stickers', err)
          if (!cancelled) setStickers((current) => current ?? [])
        })
    load()
    // Synced in from another device.
    collectionEvents.addEventListener('remote', load)
    return () => {
      cancelled = true
      collectionEvents.removeEventListener('remote', load)
    }
  }, [withUrl])

  useEffect(() => {
    const map = urls.current
    return () => {
      map.forEach((url) => URL.revokeObjectURL(url))
      map.clear()
    }
  }, [])

  const add = useCallback(
    async (record: StickerRecord) => {
      await saveSticker(record)
      setStickers((current) => [withUrl(record), ...(current ?? [])])
    },
    [withUrl],
  )

  const remove = useCallback(async (id: string) => {
    await deleteSticker(id)
    setStickers((current) => current?.filter((s) => s.id !== id) ?? null)
    const url = urls.current.get(id)
    if (url) {
      urls.current.delete(id)
      // Let the closing animation finish with the image still visible.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }, [])

  const update = useCallback(async (id: string, patch: Parameters<typeof updateSticker>[1]) => {
    await updateSticker(id, patch)
    setStickers((current) => current?.map((s) => (s.id === id ? { ...s, ...patch } : s)) ?? null)
  }, [])

  /** Keeps an original picture downloaded for a sticker made on another device. */
  const attachOriginal = useCallback(async (id: string, original: Blob) => {
    await storeOriginal(id, original)
    setStickers((current) => current?.map((s) => (s.id === id ? { ...s, original } : s)) ?? null)
  }, [])

  return { stickers, add, remove, update, attachOriginal }
}
