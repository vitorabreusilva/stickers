import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { firstImageFile } from '../lib/device'
import { folderColor, folderLabel, type FolderColor, type FolderKey } from '../lib/folders'
import type { TopicGroup } from '../lib/topics'
import type { Book } from '../hooks/useColoringBooks'
import type { Sticker } from '../hooks/useStickers'
import { BookCard, NewBookCard } from './BookCard'
import { Folder } from './Folder'
import { StickerArt } from './StickerArt'
import { CloseIcon, GoogleIcon, PasteIcon, PlusIcon, SettingsIcon, StarMascot } from './icons'

interface Props {
  stickers: Sticker[] | null
  groups: TopicGroup<Sticker>[]
  /** Names of the AI folders. */
  labels: ReadonlyMap<string, { name: string; emoji: string }>
  /** Colours picked for folders; null while loading. */
  colors: ReadonlyMap<string, FolderColor> | null
  /** Whether stickers are being sorted into topics right now. */
  sorting: boolean
  freshId: string | null
  canPaste: boolean
  onImage: (file: Blob) => void
  onPaste: () => void
  onOpen: (id: string) => void
  /** Names the user gave folders. */
  names: ReadonlyMap<string, string>
  onOpenFolder: (key: FolderKey) => void
  /** Right-click or press and hold on a folder. */
  onFolderMenu: (key: FolderKey) => void
  /** The coloring books, newest first; null while loading. */
  books: Book[] | null
  onOpenBook: (id: string) => void
  onNewBook: () => void
  onOpenBackup: () => void
  /** Set while signed out, to offer signing in right on the home screen. */
  onSignIn?: () => void
}

const SIGN_IN_DISMISSED = 'stickers.signInDismissed'
/** How many of the newest stickers the home screen shows up top. */
const LATEST = 5

export function Collection({
  stickers,
  groups,
  labels,
  colors,
  sorting,
  freshId,
  canPaste,
  onImage,
  onPaste,
  onOpen,
  names,
  onOpenFolder,
  onFolderMenu,
  books,
  onOpenBook,
  onNewBook,
  onOpenBackup,
  onSignIn,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // "Not now" on the sign-in banner sticks; signing in is still in Settings.
  const [signInDismissed, setSignInDismissed] = useState(() => {
    try {
      return localStorage.getItem(SIGN_IN_DISMISSED) === '1'
    } catch {
      return false
    }
  })
  const dismissSignIn = () => {
    setSignInDismissed(true)
    try {
      localStorage.setItem(SIGN_IN_DISMISSED, '1')
    } catch {
      // It just comes back next time.
    }
  }

  const count = stickers?.length ?? 0
  // With a single group, "All stickers" would be the same folder twice.
  const folders: { key: FolderKey; items: Sticker[] }[] =
    groups.length > 1 ? [{ key: 'all', items: stickers ?? [] }, ...groups] : groups
  const latest = (stickers ?? []).slice(0, LATEST)
  const showBooks = count > 0 || !!books?.length

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = firstImageFile(e.target.files)
    e.target.value = ''
    if (file) onImage(file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = firstImageFile(e.dataTransfer.files)
    if (file) onImage(file)
  }

  return (
    <div
      className="collection"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="collection-header">
        <h1>
          Stickers
          {count > 0 && <span className="count">{count}</span>}
        </h1>
        <button className="icon-btn backup-btn" onClick={onOpenBackup} aria-label="Settings">
          <SettingsIcon />
        </button>
      </header>

      {onSignIn && !signInDismissed && (
        <section className="sign-in-banner" aria-label="Sign in">
          <p>Sign in to sync your stickers across your devices.</p>
          <button className="btn btn-secondary sign-in-btn" onClick={onSignIn}>
            <GoogleIcon /> Sign in with Google
          </button>
          <button className="icon-btn sign-in-dismiss" onClick={dismissSignIn} aria-label="Not now">
            <CloseIcon />
          </button>
        </section>
      )}

      {stickers && count === 0 && (
        <section className="empty">
          <StarMascot />
          <h2>Your sticker book is empty</h2>
          <p>
            Pick a picture you love, draw a loop around the good part, and it becomes a sticker.
            {canPaste && ' You can also copy an image in your browser and paste it here.'}
          </p>
        </section>
      )}

      {count > 0 && (
        <section className="home-section" aria-labelledby="latest-heading">
          <div className="home-section-head">
            <h2 id="latest-heading">Latest</h2>
            <button className="see-all" onClick={() => onOpenFolder('all')}>
              View all
            </button>
          </div>
          <ul className="latest" aria-label="Latest stickers">
            {latest.map((sticker) => (
              <li key={sticker.id}>
                <button
                  className={`latest-item${sticker.id === freshId ? ' fresh' : ''}`}
                  onClick={() => onOpen(sticker.id)}
                  aria-label="Open sticker"
                >
                  <StickerArt image={sticker} effect={sticker.effect} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Wait for the saved colours so folders don't flash their defaults first. */}
      {count > 0 && colors && (
        <section className="home-section" aria-labelledby="folders-heading">
          <h2 id="folders-heading">Folders</h2>
          <ul className="folders" aria-label="Folders">
            {folders.map(({ key, items }) => {
              const { emoji, name } = folderLabel(key, sorting, labels, names)
              return (
                <li key={key}>
                  <Folder
                    name={name}
                    emoji={emoji}
                    items={items}
                    color={folderColor(key, colors)}
                    freshId={freshId}
                    onOpen={() => onOpenFolder(key)}
                    onMenu={() => onFolderMenu(key)}
                  />
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {showBooks && books && (
        <section className="home-section" aria-labelledby="books-heading">
          <h2 id="books-heading">
            Coloring books <span className="beta">Beta</span>
          </h2>
          <ul className="shelf" aria-label="Coloring books">
            {books.map((book) => (
              <li key={book.id}>
                <BookCard book={book} onOpen={() => onOpenBook(book.id)} />
              </li>
            ))}
            <li>
              <NewBookCard onClick={onNewBook} />
            </li>
          </ul>
          {!books.length && (
            <p className="shelf-hint">Open a sticker and tap Color to turn it into a page for a coloring book.</p>
          )}
        </section>
      )}

      <div className="dock">
        {canPaste && (
          <button className="btn btn-secondary" onClick={onPaste}>
            <PasteIcon /> Paste
          </button>
        )}
        <button className="btn btn-primary btn-big" onClick={() => inputRef.current?.click()}>
          <PlusIcon /> New sticker
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          hidden
          data-testid="file-input"
        />
      </div>

      {dragging && <div className="drop-hint">Drop an image to make a sticker</div>}
    </div>
  )
}
