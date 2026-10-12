import { useMemo, useState } from 'react'
import { canCopyImage, canShareFile, copyImage, downloadBlob, shareFile } from '../lib/device'
import { bakeEffect } from '../lib/effect-render'
import { EFFECT_INFO, effectOf, type StickerEffect } from '../lib/effects'
import { enableTilt } from '../lib/light'
import { groupLabel } from '../lib/smart-groups'
import { TOPIC_IDS, TOPICS, type GroupKey } from '../lib/topics'
import type { Sticker } from '../hooks/useStickers'
import { EffectPicker } from './EffectPicker'
import { CloseIcon, CopyIcon, CrayonIcon, DownloadIcon, ShareIcon, TrashIcon } from './icons'
import { StickerArt } from './StickerArt'

interface Props {
  sticker: Sticker
  /** The folder it's in; undefined while it's still being sorted. */
  topic: GroupKey | undefined
  /** The AI folders in the collection, to move it to. */
  aiFolders: { key: GroupKey; name: string; emoji: string }[]
  onClose: () => void
  onDelete: () => Promise<void>
  /** Moves the sticker to a folder, or back to automatic sorting with null. */
  onTopic: (topic: GroupKey | null) => Promise<void>
  onEffect: (effect: StickerEffect) => Promise<void>
  /** Opens the coloring page maker for this sticker. */
  onColor: () => void
  toast: (message: string) => void
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

export function StickerDetail({ sticker, topic, aiFolders, onClose, onDelete, onTopic, onEffect, onColor, toast }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [picking, setPicking] = useState<'topic' | 'effect' | null>(null)
  const effect = effectOf(sticker.effect)
  const byHand = !!sticker.topic || !!sticker.ai?.folder?.pinned
  const label = topic ? groupLabel(topic, new Map(aiFolders.map((f) => [f.key, f]))) : null
  const filename = `sticker-${sticker.id.slice(0, 8)}.png`
  // Shared, copied and saved images get the effect baked in as a still frame. Started right away
  // so it's ready by the time a button is tapped (share sheets need the tap to be recent).
  const exported = useMemo(
    () =>
      bakeEffect(sticker.blob, effect).catch((err) => {
        console.error('Could not apply the effect', err)
        return sticker.blob
      }),
    [sticker.blob, effect],
  )
  const shareable = useMemo(
    () => canShareFile(new File([sticker.blob], filename, { type: 'image/png' })),
    [sticker.blob, filename],
  )

  const share = async () => {
    try {
      await shareFile(new File([await exported], filename, { type: 'image/png' }))
    } catch {
      toast("Couldn't open the share sheet")
    }
  }

  const copy = async () => {
    try {
      await copyImage(exported)
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
      {/* Tapping the sticker is how iOS users let its sheen follow the phone's tilt. */}
      <div className="detail-sticker" onClick={effect !== 'none' ? enableTilt : undefined}>
        <StickerArt image={sticker} effect={effect} alt="Sticker" idle />
      </div>
      <p className="detail-date">Collected {dateFormat.format(sticker.createdAt)}</p>
      <div className="detail-pills">
        <button className="topic-pill" onClick={() => setPicking('topic')}>
          {label ? `${label.emoji} ${label.name}` : '⏳ Sorting…'}
          {byHand && <span className="topic-pill-note">your pick</span>}
        </button>
        <button className="effect-pill" onClick={() => setPicking('effect')}>
          ✨ {effect === 'none' ? 'Add effect' : EFFECT_INFO[effect].name}
        </button>
      </div>

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
        <button className="action" onClick={async () => downloadBlob(await exported, filename)}>
          <DownloadIcon />
          <span>Save</span>
        </button>
        <button className="action" onClick={onColor}>
          <CrayonIcon />
          <span>Color</span>
        </button>
        <button className={`action action-danger${confirming ? ' confirming' : ''}`} onClick={remove}>
          <TrashIcon />
          <span>{confirming ? 'Sure?' : 'Delete'}</span>
        </button>
      </div>

      {picking === 'effect' && (
        <div className="topic-picker" role="dialog" aria-label="Choose effect">
          <p className="topic-picker-title">Effect</p>
          <EffectPicker
            image={sticker}
            value={effect}
            onChange={(value) => onEffect(value).catch(() => toast("Couldn't change the effect"))}
          />
          <button className="btn btn-secondary topic-picker-auto" onClick={() => setPicking(null)}>
            Done
          </button>
        </div>
      )}

      {picking === 'topic' && (
        <div className="topic-picker" role="dialog" aria-label="Move to topic">
          <p className="topic-picker-title">Move to…</p>
          {sticker.ai && aiFolders.length > 0 && (
            <div className="topic-picker-options topic-picker-ai" role="group" aria-label="Your folders">
              {aiFolders.map((folder) => (
                <button
                  key={folder.key}
                  className={`chip${folder.key === topic ? ' active' : ''}`}
                  onClick={async () => {
                    setPicking(null)
                    await onTopic(folder.key)
                  }}
                >
                  {folder.emoji} {folder.name}
                </button>
              ))}
            </div>
          )}
          <div className="topic-picker-options">
            {TOPIC_IDS.map((id) => (
              <button
                key={id}
                className={`chip${id === topic ? ' active' : ''}`}
                onClick={async () => {
                  setPicking(null)
                  await onTopic(id)
                }}
              >
                {TOPICS[id].emoji} {TOPICS[id].name}
              </button>
            ))}
          </div>
          {byHand && (
            <button
              className="btn btn-secondary topic-picker-auto"
              onClick={async () => {
                setPicking(null)
                await onTopic(null)
              }}
            >
              ✨ Let the app decide
            </button>
          )}
          <button className="btn btn-ghost topic-picker-cancel" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
