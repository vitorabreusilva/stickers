// The coloring book's title lives in localStorage; it's one short string and needs no database.

const TITLE_KEY = 'stickers.bookTitle'
export const DEFAULT_TITLE = 'My Coloring Book'

/** The title the user typed, or null if they never changed it. */
export function storedBookTitle(): string | null {
  try {
    return localStorage.getItem(TITLE_KEY)
  } catch {
    return null
  }
}

export function storeBookTitle(value: string) {
  try {
    localStorage.setItem(TITLE_KEY, value)
  } catch {
    // Not remembering the title is fine.
  }
}
