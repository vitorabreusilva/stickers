import { useMemo } from 'react'
import type { BookSide } from '../lib/book-layout'
import { bookContents, useBookPreviews } from '../hooks/useBookPreviews'
import type { Book } from '../hooks/useColoringBooks'
import { PlusIcon } from './icons'

const COVER_ONLY: BookSide[] = [{ kind: 'cover' }]

export const pageCount = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`

/** A coloring book on the home screen's shelf: its cover, title and size. */
export function BookCard({ book, onOpen }: { book: Book; onOpen: () => void }) {
  const contents = useMemo(() => bookContents(book), [book])
  const [cover] = useBookPreviews(contents, COVER_ONLY)
  return (
    <button className="book-card" onClick={onOpen} aria-label={`${book.title}, ${pageCount(book.pages.length)}`}>
      <span className="book-card-cover">{cover ? <img src={cover} alt="" draggable={false} /> : <span className="spinner" />}</span>
      <span className="book-card-title">{book.title}</span>
      <span className="book-card-count">{book.pages.length ? pageCount(book.pages.length) : 'No pages yet'}</span>
    </button>
  )
}

export function NewBookCard({ onClick }: { onClick: () => void }) {
  return (
    <button className="book-card book-card-new" onClick={onClick}>
      <span className="book-card-cover">
        <PlusIcon />
      </span>
      <span className="book-card-title">New book</span>
      <span className="book-card-count">Start a fresh one</span>
    </button>
  )
}
