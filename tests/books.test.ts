import { describe, expect, it } from 'vitest'
import { bookFileName, DEFAULT_TITLE, newBookTitle } from '../src/lib/books'

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
