import { describe, expect, it } from 'vitest'
import { bookFileName, DEFAULT_TITLE, newBookTitle, pagesOfSticker } from '../src/lib/books'

describe('newBookTitle', () => {
  it('names the first book after the default, then numbers the rest', () => {
    expect(newBookTitle([])).toBe(DEFAULT_TITLE)
    expect(newBookTitle(['Sunny Days'])).toBe(DEFAULT_TITLE)
    expect(newBookTitle(['my coloring book '])).toBe('Coloring Book 2')
    expect(newBookTitle([DEFAULT_TITLE, 'Coloring Book 2'])).toBe('Coloring Book 3')
  })
})

describe('bookFileName', () => {
  it('makes a tidy file name from the title', () => {
    expect(bookFileName('Sunny Days!')).toBe('sunny-days.pdf')
    expect(bookFileName('Café & Crêpes', '-booklet')).toBe('café-crêpes-booklet.pdf')
    expect(bookFileName('   ')).toBe('my-coloring-book.pdf')
    expect(bookFileName('!!!')).toBe('coloring-book.pdf')
  })
})

describe('pages of a sticker', () => {
  const books = [
    { id: 'a', pages: [{ id: 'p1', stickerId: 'x' }, { id: 'p2', stickerId: 'y' }, { id: 'p3', stickerId: 'x' }] },
    { id: 'b', pages: [{ id: 'p4', stickerId: 'x' }] },
    { id: 'c', pages: [] },
  ]

  it('finds every page made from it, with its page number', () => {
    expect(pagesOfSticker(books, 'x').map(({ book, page, folio }) => [book.id, page.id, folio])).toEqual([
      ['a', 'p1', 1],
      ['a', 'p3', 3],
      ['b', 'p4', 1],
    ])
  })

  it('finds nothing for a sticker without pages', () => {
    expect(pagesOfSticker(books, 'z')).toEqual([])
  })
})
