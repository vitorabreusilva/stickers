import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { firstImageFile } from '../lib/device'
import { folderColor, folderLabel, type FolderColor, type FolderKey } from '../lib/folders'
import type { TopicGroup } from '../lib/topics'
import type { Sticker } from '../hooks/useStickers'
import { Folder } from './Folder'
import { StickerGrid } from './StickerGrid'
import { BookIcon, CloseIcon, GoogleIcon, PasteIcon, PlusIcon, SettingsIcon, StarMascot } from './icons'

interface Props {
  stickers: Sticker[] | null
  groups: TopicGroup<Sticker>[]
  /** Colours picked for folders; null while loading. */
  colors: ReadonlyMap<string, FolderColor> | null
  /** Whether stickers are being sorted into topics right now. */
  sorting: boolean
  freshId: string | null
  canPaste: boolean
  onImage: (file: Blob) => void
  onPaste: () => void
  onOpen: (id: string) => void
  onOpenFolder: (key: FolderKey) => void
  /** Pages in the coloring book; null while loading. */
  bookPages: number | null
  onOpenBook: () => void
  onOpenBackup: () => void
  /** Set while signed out, to offer signing in right on the home screen. */
  onSignIn?: () => void
}

const SIGN_IN_DISMISSED = 'stickers.signInDismissed'

export function Collection({
  stickers,
  groups,
  colors,
  sorting,
  freshId,
  canPaste,
  onImage,
  onPaste,
  onOpen,
  onOpenFolder,
  bookPages,
  onOpenBook,
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
  // A single group needs no folders; the stickers go straight on the page.
  const foldered = groups.length > 1
  const folders: { key: FolderKey; items: Sticker[] }[] = [{ key: 'all', items: stickers ?? [] }, ...groups]

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
        <div className="collection-actions">
          {(count > 0 || !!bookPages) && (
            <button className="book-btn" onClick={onOpenBook} aria-label={`Coloring book, ${bookPages ?? 0} pages`}>
              <BookIcon />
              <span>Coloring book</span>
              {!!bookPages && <span className="book-btn-count">{bookPages}</span>}
            </button>
          )}
          <button className="icon-btn backup-btn" onClick={onOpenBackup} aria-label="Settings">
            <SettingsIcon />
          </button>
        </div>
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

      {count > 0 &&
        (foldered ? (
          // Wait for the saved colours so folders don't flash their defaults first.
          colors && (
            <ul className="folders" aria-label="Folders">
              {folders.map(({ key, items }) => {
                const { emoji, name } = folderLabel(key, sorting)
                return (
                  <li key={key}>
                    <Folder
                      name={name}
                      emoji={emoji}
                      items={items}
                      color={folderColor(key, colors)}
                      freshId={freshId}
                      onOpen={() => onOpenFolder(key)}
                    />
                  </li>
                )
              })}
            </ul>
          )
        ) : (
          <StickerGrid items={stickers!} label="Your stickers" freshId={freshId} onOpen={onOpen} />
        ))}

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
