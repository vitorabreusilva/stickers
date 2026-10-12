import { useMemo, useState } from 'react'
import { canCopyImage, canShareFile, copyImage, downloadBlob, shareFile } from '../lib/device'
import type { Sticker } from '../hooks/useStickers'
import { CloseIcon, CopyIcon, DownloadIcon, ShareIcon, TrashIcon } from './icons'

interface Props {
  sticker: Sticker
  onClose: () => void
  onDelete: () => Promise<void>
  toast: (message: string) => void
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export function StickerDetail({ sticker, onClose, onDelete, toast }: Props) {
  const [confirming, setConfirming] = useState(false)
  const file = useMemo(
    () => new File([sticker.blob], `sticker-${sticker.id.slice(0, 8)}.png`, { type: 'image/png' }),
    [sticker],
  )
  const shareable = useMemo(() => canShareFile(file), [file])

  const share = async () => {
    try {
      await shareFile(file)
    } catch {
      toast("Couldn't open the share sheet")
    }
  }

  const copy = async () => {
    try {
      await copyImage(sticker.blob)
      toast('Copied! Paste it anywhere')
    } catch {
      toast("Couldn't copy on this browser")
    }
  }

  const remove = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    try {
      await onDelete()
    } catch {
      toast("Couldn't delete the sticker")
    }
  }

  return (
    <div
      className="detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Sticker"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <button className="icon-btn detail-close" onClick={onClose} aria-label="Close">
        <CloseIcon />
      </button>
      <img className="detail-sticker" src={sticker.url} alt="Sticker" />
      <p className="detail-date">Collected {dateFormat.format(sticker.createdAt)}</p>

      <div className="detail-actions">
        {shareable && (
          <button className="action" onClick={share}>
            <ShareIcon />
            <span>Share</span>
          </button>
        )}
        {canCopyImage() && (
          <button className="action" onClick={copy}>
            <CopyIcon />
            <span>Copy</span>
          </button>
        )}
        <button className="action" onClick={() => downloadBlob(sticker.blob, file.name)}>
          <DownloadIcon />
          <span>Save</span>
        </button>
        <button className={`action action-danger${confirming ? ' confirming' : ''}`} onClick={remove}>
          <TrashIcon />
          <span>{confirming ? 'Sure?' : 'Delete'}</span>
        </button>
      </div>
    </div>
  )
}
