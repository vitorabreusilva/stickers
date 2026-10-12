import { useCallback, useEffect, useRef, useState } from 'react'
import { collectionEvents, deleteBookPage, listBookPages, reorderBook, saveBookPage, type BookPageRecord } from '../lib/db'

export interface BookPage extends BookPageRecord {
  /** Object URL of the page, for <img>. */
  url: string
}

/** The coloring book's pages from IndexedDB, in order. null while loading. */
export function useColoringBook() {
  const [pages, setPages] = useState<BookPage[] | null>(null)
  const pagesRef = useRef<BookPage[]>([])
  const urls = useRef(new Map<string, string>())

  const commit = (next: BookPage[]) => {
    pagesRef.current = next
    setPages(next)
  }

  const withUrl = useCallback((record: BookPageRecord): BookPage => {
    let url = urls.current.get(record.id)
    if (!url) {
      url = URL.createObjectURL(record.page)
      urls.current.set(record.id, url)
    }
    return { ...record, url }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listBookPages()
        .then((records) => {
          if (cancelled) return
          const ids = new Set(records.map((r) => r.id))
          urls.current.forEach((url, id) => {
            if (!ids.has(id)) {
              urls.current.delete(id)
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }
          })
          commit(records.map(withUrl))
        })
        .catch((err) => {
          console.error('Could not load the coloring book', err)
          if (!cancelled && !pagesRef.current.length) commit([])
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
    async (record: Omit<BookPageRecord, 'position'>) => {
      const current = pagesRef.current
      const position = current.length ? current[current.length - 1].position + 1 : 0
      const full = { ...record, position }
      await saveBookPage(full)
      commit([...pagesRef.current, withUrl(full)])
    },
    [withUrl],
  )

  const remove = useCallback(async (id: string) => {
    await deleteBookPage(id)
    commit(pagesRef.current.filter((p) => p.id !== id))
    const url = urls.current.get(id)
    if (url) {
      urls.current.delete(id)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }, [])

  /** Moves a page `by` places earlier (negative) or later (positive). */
  const move = useCallback(async (id: string, by: number) => {
    const current = [...pagesRef.current]
    const from = current.findIndex((p) => p.id === id)
    const to = from + by
    if (from < 0 || to < 0 || to >= current.length) return
    const [page] = current.splice(from, 1)
    current.splice(to, 0, page)
    commit(current.map((p, position) => ({ ...p, position })))
    await reorderBook(current.map((p) => p.id))
  }, [])

  return { pages, add, remove, move }
}
