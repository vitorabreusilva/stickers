import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { backupFilename, BackupError, createBackup, readBackup, type BackupContents } from '../lib/backup'
import { storeBookTitle, storedBookTitle } from '../lib/book-title'
import { readAll, restoreAll } from '../lib/db'
import { canShareFile, downloadBlob, shareFile } from '../lib/device'
import { CloseIcon, DownloadIcon, ShareIcon } from './icons'

interface Props {
  onClose: () => void
  toast: (message: string) => void
}

type Prepared = { file: File; stickers: number; pages: number }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function sizeLabel(bytes: number) {
  return bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`
}

/** Saves the whole collection to one file, and brings one back. */
export function BackupSheet({ onClose, toast }: Props) {
  // The file is made as soon as the sheet opens, so Download and Share run straight from the tap;
  // Safari drops the share sheet if the tap is followed by a long await.
  const [prepared, setPrepared] = useState<Prepared | 'error' | null>(null)
  const [restoring, setRestoring] = useState<BackupContents | null>(null)
  const [restored, setRestored] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const all = await readAll()
      const blob = await createBackup({ ...all, bookTitle: storedBookTitle() })
      const file = new File([blob], backupFilename(), { type: 'application/json' })
      if (!cancelled) setPrepared({ file, stickers: all.stickers.length, pages: all.book.length })
    })().catch((err) => {
      console.error('Could not make a backup', err)
      if (!cancelled) setPrepared('error')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const ready = prepared && prepared !== 'error' ? prepared : null
  const canShare = !!ready && canShareFile(ready.file)

  const share = async () => {
    if (!ready) return
    try {
      await shareFile(ready.file)
    } catch {
      toast("Couldn't share. Try Download instead.")
    }
  }

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setRestoring(await readBackup(file))
    } catch (err) {
      toast(err instanceof BackupError ? err.message : "Couldn't read that backup")
    }
  }

  const restore = async () => {
    if (!restoring) return
    try {
      await restoreAll(restoring)
      if (restoring.bookTitle !== null) storeBookTitle(restoring.bookTitle)
      setRestored(true)
      // Every screen reads the database on start, so the simplest way to show it all is a fresh start.
      setTimeout(() => location.reload(), 900)
    } catch (err) {
      console.error('Could not restore', err)
      toast("Couldn't restore. Your phone may be out of space.")
    }
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet backup-sheet" role="dialog" aria-modal="true" aria-label="Backup">
        <header className="sheet-header">
          <span className="icon-btn-spacer" />
          <h2>Backup</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        {restored ? (
          <p className="backup-text backup-done" role="status">
            Restored {plural(restoring!.stickers.length, 'sticker')}! Reloading…
          </p>
        ) : restoring ? (
          <>
            <p className="backup-text">
              This backup has {plural(restoring.stickers.length, 'sticker')}
              {restoring.book.length > 0 && ` and ${plural(restoring.book.length, 'coloring page')}`}. They&rsquo;ll be
              added to this collection; nothing here is deleted.
            </p>
            <div className="sheet-actions">
              <button className="btn btn-secondary" onClick={() => setRestoring(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={restore}>
                Restore
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="backup-text">
              Save your whole collection to one file: stickers, folder colours and the coloring book. Keep it somewhere
              safe, or open it on another device to bring everything across. AI keys aren&rsquo;t included.
            </p>
            <p className="backup-summary" aria-live="polite">
              {prepared === 'error'
                ? "Couldn't make a backup. Try closing and opening this again."
                : ready
                  ? `${plural(ready.stickers, 'sticker')}${ready.pages ? `, ${plural(ready.pages, 'coloring page')}` : ''} · ${sizeLabel(ready.file.size)}`
                  : 'Packing up your stickers…'}
            </p>
            <div className="sheet-actions">
              {canShare && (
                <button className="btn btn-secondary" onClick={share}>
                  <ShareIcon /> Share
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={!ready}
                onClick={() => ready && downloadBlob(ready.file, ready.file.name)}
              >
                <DownloadIcon /> Download backup
              </button>
            </div>

            <hr className="backup-divider" />
            <button className="btn btn-ghost backup-restore" onClick={() => inputRef.current?.click()}>
              Restore from a backup…
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              onChange={pick}
              hidden
              data-testid="backup-input"
            />
          </>
        )}
      </div>
    </div>
  )
}
