import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { storedBookTitle } from '../lib/book-title'
import { DEFAULT_STYLE, DEFAULT_TITLE, LEGACY_BOOK_ID, newBookTitle } from '../lib/books'
import {
  bookIdOf,
  collectionEvents,
  deleteBook,
  deleteBookPage,
  listBookPages,
  listBooks,
  newId,
  reorderBook,
  saveBook,
  saveBookPage,
  type BookPageRecord,
  type BookRecord,
} from '../lib/db'

export interface BookPage extends BookPageRecord {
  /** Object URL of the page, for <img>. */
  url: string
}

export interface Book extends BookRecord {
  pages: BookPage[]
}

/**
 * The coloring books and their pages from IndexedDB, newest book first. null while loading.
 * Pages from before there could be several books form a book of their own until it gets a record.
 */
export function useColoringBooks() {
  const [records, setRecords] = useState<BookRecord[] | null>(null)
  const [pages, setPages] = useState<BookPage[]>([])
  const recordsRef = useRef<BookRecord[]>([])
  const pagesRef = useRef<BookPage[]>([])
  const urls = useRef(new Map<string, string>())

  const commitPages = (next: BookPage[]) => {
    pagesRef.current = next
    setPages(next)
  }
  const commitRecords = (next: BookRecord[]) => {
    recordsRef.current = next
    setRecords(next)
  }

  const withUrl = useCallback((record: BookPageRecord): BookPage => {
    let url = urls.current.get(record.id)
    if (!url) {
      url = URL.createObjectURL(record.page)
      urls.current.set(record.id, url)
    }
    return { ...record, url }
  }, [])

  const forgetUrl = (id: string) => {
    const url = urls.current.get(id)
    if (!url) return
    urls.current.delete(id)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  useEffect(() => {
    let cancelled = false
    const load = () =>
      Promise.all([listBooks(), listBookPages()])
        .then(([books, records]) => {
          if (cancelled) return
          const ids = new Set(records.map((r) => r.id))
          urls.current.forEach((_, id) => !ids.has(id) && forgetUrl(id))
          commitPages(records.map(withUrl))
          commitRecords(books)
        })
        .catch((err) => {
          console.error('Could not load the coloring books', err)
          if (!cancelled && !recordsRef.current.length) commitRecords([])
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

  const books = useMemo<Book[] | null>(() => {
    if (!records) return null
    const byBook = new Map<string, BookPage[]>()
    for (const page of pages) {
      const id = bookIdOf(page)
      byBook.set(id, [...(byBook.get(id) ?? []), page])
    }
    const out: Book[] = records.map((r) => ({ ...r, pages: byBook.get(r.id) ?? [] }))
    const legacy = byBook.get(LEGACY_BOOK_ID)
    if (legacy && !records.some((r) => r.id === LEGACY_BOOK_ID)) {
      out.push({
        id: LEGACY_BOOK_ID,
        title: storedBookTitle() ?? DEFAULT_TITLE,
        ...DEFAULT_STYLE,
        createdAt: Math.min(...legacy.map((p) => p.createdAt)),
        pages: legacy,
      })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }, [records, pages])

  const booksRef = useRef(books)
  booksRef.current = books

  const create = useCallback(async (title?: string): Promise<BookRecord> => {
    const record: BookRecord = {
      id: newId(),
      title: title ?? newBookTitle((booksRef.current ?? []).map((b) => b.title)),
      ...DEFAULT_STYLE,
      createdAt: Date.now(),
    }
    await saveBook(record)
    commitRecords([...recordsRef.current, record])
    return record
  }, [])

  /** Changes a book's title or cover. The first book gets its record here, the first time it's edited. */
  const update = useCallback(async (id: string, patch: Partial<Omit<BookRecord, 'id'>>) => {
    const current = booksRef.current?.find((b) => b.id === id)
    if (!current) return
    const { pages: _, ...record } = current
    const next = { ...record, ...patch }
    commitRecords([...recordsRef.current.filter((r) => r.id !== id), next])
    await saveBook(next)
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteBook(id)
    commitRecords(recordsRef.current.filter((r) => r.id !== id))
    const gone = pagesRef.current.filter((p) => bookIdOf(p) === id)
    commitPages(pagesRef.current.filter((p) => bookIdOf(p) !== id))
    gone.forEach((p) => forgetUrl(p.id))
  }, [])

  const addPage = useCallback(
    async (bookId: string, record: Omit<BookPageRecord, 'position' | 'bookId'>) => {
      const inBook = pagesRef.current.filter((p) => bookIdOf(p) === bookId)
      const position = inBook.length ? inBook[inBook.length - 1].position + 1 : 0
      const full: BookPageRecord = { ...record, ...(bookId !== LEGACY_BOOK_ID && { bookId }), position }
      await saveBookPage(full)
      commitPages([...pagesRef.current, withUrl(full)])
    },
    [withUrl],
  )

  const removePage = useCallback(async (id: string) => {
    await deleteBookPage(id)
    commitPages(pagesRef.current.filter((p) => p.id !== id))
    forgetUrl(id)
  }, [])

  /** Moves a page `by` places earlier (negative) or later (positive) within its book. */
  const movePage = useCallback(async (id: string, by: number) => {
    const page = pagesRef.current.find((p) => p.id === id)
    if (!page) return
    const bookId = bookIdOf(page)
    const inBook = pagesRef.current.filter((p) => bookIdOf(p) === bookId)
    const from = inBook.findIndex((p) => p.id === id)
    const to = from + by
    if (to < 0 || to >= inBook.length) return
    inBook.splice(from, 1)
    inBook.splice(to, 0, page)
    // The book's pages fill their old slots in the new order; other books' pages stay put.
    let next = 0
    commitPages(
      pagesRef.current.map((p) => {
        if (bookIdOf(p) !== bookId) return p
        const position = next++
        return { ...inBook[position], position }
      }),
    )
    await reorderBook(inBook.map((p) => p.id))
  }, [])

  return { books, create, update, remove, addPage, removePage, movePage }
}
