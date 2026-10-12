// The coloring book's title lives in localStorage; it's one short string and needs no database.

import { bookTitleChanged } from './db'

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

// Local edits whose outbox entry isn't written yet. Records save data and outbox entry in one
// transaction, but the title is saved here at once and queued after, so a title arriving from the
// server in between must not overwrite it.
let queueing = 0

/** Saves a title typed on this device, and queues it to sync. */
export function storeBookTitle(value: string) {
  if (!writeTitle(value)) return
  queueing++
  bookTitleChanged()
    .catch((err) => console.warn('Could not queue the book title', err))
    .finally(() => queueing--)
}

/** Saves a title that came from another device, unless one typed here is still on its way out. */
export function receiveBookTitle(value: string | null) {
  if (!queueing) writeTitle(value)
}

function writeTitle(value: string | null) {
  try {
    if (value === null) localStorage.removeItem(TITLE_KEY)
    else localStorage.setItem(TITLE_KEY, value)
    return true
  } catch {
    // Not remembering the title is fine.
    return false
  }
}
