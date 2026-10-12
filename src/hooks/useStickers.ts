import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteSticker, listStickers, saveSticker, type StickerRecord } from '../lib/db'

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
    listStickers()
      .then((records) => !cancelled && setStickers(records.map(withUrl)))
      .catch((err) => {
        console.error('Could not load stickers', err)
        if (!cancelled) setStickers([])
      })
    return () => {
      cancelled = true
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

  return { stickers, add, remove }
}
