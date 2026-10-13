import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackupSheet } from './components/BackupSheet'
import { BookPreview } from './components/BookPreview'
import { BookView } from './components/BookView'
import { Collection } from './components/Collection'
import { ColoringStudio } from './components/ColoringStudio'
import { FolderSettings } from './components/FolderSettings'
import { FolderView } from './components/FolderView'
import { LassoEditor } from './components/LassoEditor'
import { StickerDetail } from './components/StickerDetail'
import { StickerPreview } from './components/StickerPreview'
import { cutoutPreferred, preloadCutout } from './lib/cutout'
import { newId, requestPersistentStorage, type StickerRecord } from './lib/db'
import { signIn, SIGN_IN_ERROR_PARAM } from './lib/account'
import { canReadClipboard, firstImageFile, readClipboardImage, takeSharedImage } from './lib/device'
import { folderColor, folderLabel, stickerCount, type FolderKey } from './lib/folders'
import type { Point } from './lib/geometry'
import { loadImage, type LoadedImage } from './lib/image'
import type { StickerEffect } from './lib/effects'
import { sourcePicture, type StickerImage } from './lib/sticker'
import { aiFolderLabels, aiKey, assignGroups, isAiKey, withoutFolder } from './lib/smart-groups'
import { groupByTopic, type GroupKey } from './lib/topics'
import { useAccount } from './hooks/useAccount'
import { useAiFolders } from './hooks/useAiFolders'
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
  | { kind: 'book-preview'; id: string; side: number; customize?: boolean }

export function App() {
  const { stack, push, back, home } = useNavStack<Screen>()
  const { stickers, add, remove, update } = useStickers()
  const books = useColoringBooks()
  // Sort stickers into topics in the background, and regroup whenever anything changes.
  const analysing = useAutoAnalysis(stickers, update)
  const { account, sync, syncNow, signOut } = useAccount()
  // When signed in, the AI also names what's in each sticker and sorts them into folders.
  const aiFolders = useAiFolders(stickers, update, account.status === 'signed-in')
  const sorting = analysing || !!aiFolders.busy
  const topics = useMemo(() => assignGroups(stickers ?? [], aiFolders.preferred), [stickers, aiFolders.preferred])
  const groups = useMemo(() => groupByTopic(stickers ?? [], topics), [stickers, topics])
  const labels = useMemo(() => aiFolderLabels(stickers ?? []), [stickers])
  const aiFolderList = useMemo(
    () => groups.flatMap((g) => (g.key !== 'new' && isAiKey(g.key) ? [{ key: g.key, ...labels.get(g.key)! }] : [])).filter((f) => f.name),
    [groups, labels],
  )
  const { colors, names, setColor, setName } = useFolderColors()
  // Pictures stickers were cut from, for covers that show one.
  const sources = useMemo(
    () => new Map((stickers ?? []).flatMap((s) => (s.source && s.sourceRect ? [[s.id, { blob: s.source, rect: s.sourceRect }] as const] : []))),
    [stickers],
  )
  const shelf = useMemo(
    () =>
      books.books?.map((book) => {
        const photo = book.cover?.photo ? sources.get(book.cover.stickerId) : undefined
        return photo ? { ...book, coverPhoto: photo } : book
      }) ?? null,
    [books.books, sources],
  )
  const [toast, showToast] = useToast()
  const [freshId, setFreshId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [folderSettings, setFolderSettings] = useState<FolderKey | null>(null)
  const folderSettingsOpen = useRef(false)
  folderSettingsOpen.current = folderSettings !== null

  const folderItems = (key: FolderKey) =>
    key === 'all' ? (stickers ?? []) : (groups.find((g) => g.key === key)?.items ?? [])

  /** Has the AI sort a folder's stickers again, and says where they went. */
  const resortFolder = async (key: FolderKey) => {
    const items = folderItems(key)
    setFolderSettings(null)
    showToast(`Sorting ${stickerCount(items.length)} again…`)
    try {
      const result = await aiFolders.regroup(key === 'all' ? undefined : new Set(items.map((s) => s.id)))
      if (result === 'busy') return showToast('The AI is busy with your stickers. Try again in a moment.')
      if (result === 'empty') return showToast("Nothing in here the AI can sort yet. Give it a moment to look at these stickers.")
      const where = result.map((name) => names.get(aiKey(name)) ?? name)
      showToast(
        !where.length
          ? "The AI couldn't find a better place for these."
          : where.length === 1
            ? `Sorted into ${where[0]}`
            : `Sorted into ${where.slice(0, 2).join(', ')}${where.length > 2 ? ` and ${where.length - 2} more` : ''}`,
      )
    } catch {
      showToast("Couldn't sort the stickers. Try again in a moment.")
    }
  }

  /** Why sorting with AI can't happen right now, if it can't. */
  const resortUnavailable =
    account.status !== 'signed-in'
      ? 'Sign in to sort your stickers with AI.'
      : !aiFolders.available
        ? "Sorting with AI isn't available right now."
        : !aiFolders.preferred
          ? 'Turn on AI folders in Settings to sort with AI.'
          : undefined

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

  /** Moves a sticker to a folder by hand, or back to being sorted automatically with null. */
  const moveSticker = (sticker: StickerRecord, to: GroupKey | null) => {
    if (to === null) {
      const ai = sticker.ai?.folder?.pinned ? withoutFolder(sticker.ai) : sticker.ai
      return update(sticker.id, { topic: undefined, ai })
    }
    if (isAiKey(to)) {
      const label = labels.get(to)
      if (!sticker.ai || !label || aiKey(label.name) !== to) return Promise.resolve()
      return update(sticker.id, { topic: undefined, ai: { ...sticker.ai, folder: { ...label, pinned: true } } })
    }
    return update(sticker.id, { topic: to })
  }

  const saveSticker = async ({ blob, width, height }: StickerImage, effect: StickerEffect, image: LoadedImage, loop: Point[]) => {
    const id = newId()
    // The picture it came from, for book covers; the sticker is worth saving without it.
    const source = await sourcePicture(image, loop).catch((err) => {
      console.warn('Could not keep the original picture', err)
      return null
    })
    await add({ id, blob, width, height, createdAt: Date.now(), ...(effect !== 'none' && { effect }), ...source })
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
      if (e.key !== 'Escape') return
      // A folder's settings sit over the screen; Escape closes them first.
      if (folderSettingsOpen.current) setFolderSettings(null)
      else back()
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
        labels={labels}
        colors={colors}
        sorting={sorting}
        freshId={freshId}
        canPaste={canReadClipboard()}
        onImage={openImage}
        onPaste={pasteFromClipboard}
        onOpen={(id) => push({ kind: 'detail', id })}
        names={names}
        onOpenFolder={(key) => push({ kind: 'folder', key })}
        onFolderMenu={setFolderSettings}
        books={shelf}
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
            return (
              <StickerPreview
                key={i}
                image={screen.image}
                loop={screen.loop}
                onBack={back}
                onSave={(sticker, effect) => saveSticker(sticker, effect, screen.image, screen.loop)}
              />
            )
          case 'folder': {
            const { emoji, name } = folderLabel(screen.key, sorting, labels, names)
            return (
              <FolderView
                key={i}
                name={name}
                emoji={emoji}
                items={folderItems(screen.key)}
                color={folderColor(screen.key, colors ?? new Map())}
                freshId={freshId}
                onSettings={() => setFolderSettings(screen.key)}
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
                aiFolders={aiFolderList}
                onClose={back}
                toast={showToast}
                onTopic={(to) => moveSticker(sticker, to)}
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
            const book = shelf?.find((b) => b.id === screen.id)
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
                books={shelf ?? []}
                onCreateBook={() => books.create()}
                onRemovePage={books.removePage}
                onReorderPages={(ids) => books.reorderPages(book.id, ids)}
                onUpdatePage={books.updatePage}
                onPreview={(side, customize) => push({ kind: 'book-preview', id: book.id, side, customize })}
                onClose={back}
                toast={showToast}
              />
            )
          }
          case 'book-preview': {
            const book = shelf?.find((b) => b.id === screen.id)
            if (!book) return null
            return (
              <BookPreview
                key={i}
                book={book}
                start={screen.side}
                customize={screen.customize}
                hasPhoto={(id) => sources.has(id)}
                onUpdate={(patch) => books.update(book.id, patch)}
                onClose={back}
                toast={showToast}
              />
            )
          }
        }
      })}

      {folderSettings &&
        (() => {
          const key = folderSettings
          const { emoji, name } = folderLabel(key, sorting, labels, names)
          return (
            <FolderSettings
              name={name}
              autoName={folderLabel(key, sorting, labels).name}
              emoji={emoji}
              count={folderItems(key).length}
              color={folderColor(key, colors ?? new Map())}
              onColor={(color) => setColor(key, color).catch(() => showToast("Couldn't save the folder colour"))}
              onRename={
                key === 'new' ? undefined : (to) => setName(key, to).catch(() => showToast("Couldn't rename the folder"))
              }
              resort={
                key === 'new'
                  ? undefined
                  : { run: () => resortFolder(key), busy: aiFolders.busy === 'regrouping', unavailable: resortUnavailable }
              }
              onClose={() => setFolderSettings(null)}
            />
          )
        })()}

      {backupOpen && (
        <BackupSheet
          account={account}
          sync={sync}
          onSyncNow={syncNow}
          onSignOut={signOut}
          aiFolders={aiFolders}
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
