import { useMemo, useState } from 'react'
import { canCopyImage, canShareFile, copyImage, downloadBlob, shareFile } from '../lib/device'
import { TOPIC_IDS, TOPICS, type TopicId } from '../lib/topics'
import type { Sticker } from '../hooks/useStickers'
import { CloseIcon, CopyIcon, DownloadIcon, ShareIcon, TrashIcon } from './icons'

interface Props {
  sticker: Sticker
  /** The topic it's grouped under; undefined while it's still being sorted. */
  topic: TopicId | undefined
  onClose: () => void
  onDelete: () => Promise<void>
  /** Moves the sticker to a topic, or back to automatic sorting with null. */
  onTopic: (topic: TopicId | null) => Promise<void>
  toast: (message: string) => void
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export function StickerDetail({ sticker, topic, onClose, onDelete, onTopic, toast }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [picking, setPicking] = useState(false)
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
      <button className="topic-pill" onClick={() => setPicking(true)}>
        {topic ? `${TOPICS[topic].emoji} ${TOPICS[topic].name}` : '⏳ Sorting…'}
        {sticker.topic && <span className="topic-pill-note">your pick</span>}
      </button>

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

      {picking && (
        <div className="topic-picker" role="dialog" aria-label="Move to topic">
          <p className="topic-picker-title">Move to…</p>
          <div className="topic-picker-options">
            {TOPIC_IDS.map((id) => (
              <button
                key={id}
                className={`chip${id === topic ? ' active' : ''}`}
                onClick={async () => {
                  setPicking(false)
                  await onTopic(id)
                }}
              >
                {TOPICS[id].emoji} {TOPICS[id].name}
              </button>
            ))}
          </div>
          {sticker.topic && (
            <button
              className="btn btn-secondary topic-picker-auto"
              onClick={async () => {
                setPicking(false)
                await onTopic(null)
              }}
            >
              ✨ Let the app decide
            </button>
          )}
          <button className="btn btn-ghost topic-picker-cancel" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
