import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackupSheet } from './components/BackupSheet'
import { BookPreview } from './components/BookPreview'
import { BookView } from './components/BookView'
import { Collection } from './components/Collection'
import { ColoringStudio } from './components/ColoringStudio'
import { FolderView } from './components/FolderView'
import { LassoEditor } from './components/LassoEditor'
import { StickerDetail } from './components/StickerDetail'
import { StickerPreview } from './components/StickerPreview'
import { cutoutPreferred, preloadCutout } from './lib/cutout'
import { newId, requestPersistentStorage } from './lib/db'
import { signIn, SIGN_IN_ERROR_PARAM } from './lib/account'
import { canReadClipboard, firstImageFile, readClipboardImage, takeSharedImage } from './lib/device'
import { folderColor, folderLabel, type FolderKey } from './lib/folders'
import type { Point } from './lib/geometry'
import { loadImage, type LoadedImage } from './lib/image'
import type { StickerEffect } from './lib/effects'
import type { StickerImage } from './lib/sticker'
import { assignTopics, groupByTopic } from './lib/topics'
import { useAccount } from './hooks/useAccount'
import { useAutoAnalysis } from './hooks/useAutoAnalysis'
import { useColoringBooks } from './hooks/useColoringBooks'
import { useFolderColors } from './hooks/useFolderColors'
import { useNavStack } from './hooks/useNavStack'
import { useStickers } from './hooks/useStickers'
import { useToast } from './hooks/useToast'

type Screen =
  | { kind: 'editor'; image: LoadedImage }
  | { kind: 'preview'; image: LoadedImage; loop: Point[] }
  | { kind: 'detail'; id: string }
  | { kind: 'folder'; key: FolderKey }
  | { kind: 'coloring'; id: string }
  | { kind: 'book'; id: string }
  | { kind: 'book-preview'; id: string; side: number }

export function App() {
  const { stack, push, back, home } = useNavStack<Screen>()
  const { stickers, add, remove, update } = useStickers()
  const books = useColoringBooks()
  // Sort stickers into topics in the background, and regroup whenever anything changes.
  const sorting = useAutoAnalysis(stickers, update)
  const topics = useMemo(() => assignTopics(stickers ?? []), [stickers])
  const groups = useMemo(() => groupByTopic(stickers ?? [], topics), [stickers, topics])
  const { colors, setColor } = useFolderColors()
  const [toast, showToast] = useToast()
  const [freshId, setFreshId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const { account, sync, syncNow, signOut } = useAccount()

  const openImage = useCallback(
    async (blob: Blob) => {
      setBusy(true)
      try {
        push({ kind: 'editor', image: await loadImage(blob) })
        // Download the cutout model while the user draws.
        if (cutoutPreferred()) preloadCutout()
      } catch {
        showToast("Couldn't open that picture. Try a JPG, PNG or WebP.")
      } finally {
        setBusy(false)
      }
    },
    [push, showToast],
  )

  const pasteFromClipboard = async () => {
    try {
      const blob = await readClipboardImage()
      if (blob) openImage(blob)
      else showToast('No picture on the clipboard. Copy an image first.')
    } catch {
      showToast('Clipboard access was blocked')
    }
  }

  const saveSticker = async ({ blob, width, height }: StickerImage, effect: StickerEffect) => {
    const id = newId()
    await add({ id, blob, width, height, createdAt: Date.now(), ...(effect !== 'none' && { effect }) })
    requestPersistentStorage()
    setFreshId(id)
    home()
    showToast('Added to your collection!')
  }

  // Google sign-in that didn't work comes back with ?error=…; the sheet explains what happened.
  useEffect(() => {
    const url = new URL(location.href)
    if (!url.searchParams.has(SIGN_IN_ERROR_PARAM)) return
    url.searchParams.delete(SIGN_IN_ERROR_PARAM)
    history.replaceState(history.state, '', url)
    setBackupOpen(true)
    showToast("Couldn't sign in with that Google account. Is it on the invite list?")
  }, [showToast])

  // Images shared to the installed app from the Android share sheet.
  useEffect(() => {
    takeSharedImage()
      .then((shared) => {
        if (shared === 'none') showToast('Share a picture (not a link) to make a sticker')
        else if (shared) openImage(shared)
      })
      .catch((err) => console.error('Could not read shared image', err))
  }, [openImage, showToast])

  // Desktop conveniences: Ctrl/Cmd+V on the home screen, Escape to go back.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (stack.length > 0) return
      const file = firstImageFile(e.clipboardData?.items)
      if (file) {
        e.preventDefault()
        openImage(file)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') back()
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKey)
    }
  }, [stack.length, openImage, back])

  return (
    <>
      <Collection
        stickers={stickers}
        groups={groups}
        colors={colors}
        sorting={sorting}
        freshId={freshId}
        canPaste={canReadClipboard()}
        onImage={openImage}
        onPaste={pasteFromClipboard}
        onOpen={(id) => push({ kind: 'detail', id })}
        onOpenFolder={(key) => push({ kind: 'folder', key })}
        books={books.books}
        onOpenBook={(id) => push({ kind: 'book', id })}
        onNewBook={() =>
          books
            .create()
            .then(({ id }) => push({ kind: 'book', id }))
            .catch(() => showToast("Couldn't make a new book"))
        }
        onOpenBackup={() => setBackupOpen(true)}
        onSignIn={
          account.status === 'signed-out'
            ? () => signIn().catch(() => showToast("Couldn't reach Google. Check your connection."))
            : undefined
        }
      />

      {stack.map((screen, i) => {
        switch (screen.kind) {
          case 'editor':
            return (
              <LassoEditor
                key={i}
                image={screen.image}
                onClose={back}
                onCut={(loop) => push({ kind: 'preview', image: screen.image, loop })}
              />
            )
          case 'preview':
            return <StickerPreview key={i} image={screen.image} loop={screen.loop} onBack={back} onSave={saveSticker} />
          case 'folder': {
            const { emoji, name } = folderLabel(screen.key, sorting)
            const items =
              screen.key === 'all' ? (stickers ?? []) : (groups.find((g) => g.key === screen.key)?.items ?? [])
            return (
              <FolderView
                key={i}
                name={name}
                emoji={emoji}
                items={items}
                color={folderColor(screen.key, colors ?? new Map())}
                freshId={freshId}
                onColor={(color) =>
                  setColor(screen.key, color).catch(() => showToast("Couldn't save the folder colour"))
                }
                onOpen={(id) => push({ kind: 'detail', id })}
                onClose={back}
              />
            )
          }
          case 'detail': {
            const sticker = stickers?.find((s) => s.id === screen.id)
            if (!sticker) return null
            return (
              <StickerDetail
                key={i}
                sticker={sticker}
                topic={topics.get(sticker.id)}
                onClose={back}
                toast={showToast}
                onTopic={(topic) => update(sticker.id, { topic: topic ?? undefined })}
                onEffect={(effect) => update(sticker.id, { effect })}
                onColor={() => push({ kind: 'coloring', id: sticker.id })}
                onDelete={async () => {
                  await remove(sticker.id)
                  back()
                }}
              />
            )
          }
          case 'coloring': {
            const sticker = stickers?.find((s) => s.id === screen.id)
            if (!sticker) return null
            return (
              <ColoringStudio
                key={i}
                sticker={sticker}
                books={books.books}
                onAdd={books.addPage}
                onCreateBook={() => books.create()}
                onOpenBook={(id) => push({ kind: 'book', id })}
                onClose={back}
                toast={showToast}
              />
            )
          }
          case 'book': {
            const book = books.books?.find((b) => b.id === screen.id)
            if (!book) return null
            return (
              <BookView
                key={`${i}-${book.id}`}
                book={book}
                onUpdate={(patch) => books.update(book.id, patch)}
                onDelete={async () => {
                  await books.remove(book.id)
                  back()
                  showToast(`Deleted ${book.title}`)
                }}
                books={books.books ?? []}
                onCreateBook={() => books.create()}
                onRemovePage={books.removePage}
                onReorderPages={(ids) => books.reorderPages(book.id, ids)}
                onUpdatePage={books.updatePage}
                onPreview={(side) => push({ kind: 'book-preview', id: book.id, side })}
                onClose={back}
                toast={showToast}
              />
            )
          }
          case 'book-preview': {
            const book = books.books?.find((b) => b.id === screen.id)
            if (!book) return null
            return <BookPreview key={i} book={book} start={screen.side} onClose={back} />
          }
        }
      })}

      {backupOpen && (
        <BackupSheet
          account={account}
          sync={sync}
          onSyncNow={syncNow}
          onSignOut={signOut}
          onClose={() => setBackupOpen(false)}
          toast={showToast}
        />
      )}
      {busy && <div className="busy" aria-label="Opening picture"><div className="spinner" /></div>}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
