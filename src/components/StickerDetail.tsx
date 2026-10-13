import { useEffect, useMemo, useRef, useState } from 'react'
import type { PageOfSticker } from '../lib/books'
import { canCopyImage, canShareFile, copyImage, downloadBlob, shareFile } from '../lib/device'
import { bakeEffect } from '../lib/effect-render'
import { EFFECT_INFO, effectOf, type StickerEffect } from '../lib/effects'
import { enableTilt } from '../lib/light'
import { groupLabel } from '../lib/smart-groups'
import { TOPIC_IDS, TOPICS, type GroupKey } from '../lib/topics'
import type { Sticker } from '../hooks/useStickers'
import { EffectPicker } from './EffectPicker'
import { CloseIcon, CopyIcon, CrayonIcon, DownloadIcon, PhotoIcon, ShareIcon, TrashIcon } from './icons'
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
  /** The coloring pages made from this sticker. */
  pages: PageOfSticker<{ id: string; title: string }, { id: string; url: string }>[]
  onOpenPage: (bookId: string, pageId: string) => void
  /** Fetches the original picture from the account, for stickers made on another device. */
  onLoadOriginal?: () => Promise<Blob | null>
  toast: (message: string) => void
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const numberFormat = new Intl.NumberFormat()

export const sizeLabel = ({ width, height }: { width: number; height: number }) =>
  `${numberFormat.format(width)} × ${numberFormat.format(height)} px`

const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

export function StickerDetail({
  sticker,
  topic,
  aiFolders,
  onClose,
  onDelete,
  onTopic,
  onEffect,
  onColor,
  pages,
  onOpenPage,
  onLoadOriginal,
  toast,
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [viewingOriginal, setViewingOriginal] = useState(false)
  const stamp = sticker.kind === 'stamp'
  const canSeeOriginal = !!sticker.original || (!!sticker.originalSize && !!onLoadOriginal)
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
      aria-label={stamp ? 'Stamp' : 'Sticker'}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <button className="icon-btn detail-close" onClick={onClose} aria-label="Close">
        <CloseIcon />
      </button>
      <div className="detail-scroll" onClick={(e) => e.target === e.currentTarget && onClose()}>
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

        <section className="detail-info" aria-label="About this sticker">
          <dl className="detail-facts">
            <div>
              <dt>Style</dt>
              <dd>{stamp ? 'Stamp' : 'Die-cut sticker'}</dd>
            </div>
            <div>
              <dt>Sticker</dt>
              <dd>{sizeLabel(sticker)}</dd>
            </div>
            <div>
              <dt>Original picture</dt>
              <dd>{sticker.originalSize ? sizeLabel(sticker.originalSize) : 'Not kept'}</dd>
            </div>
          </dl>
          {canSeeOriginal ? (
            <button className="btn btn-secondary detail-original-btn" onClick={() => setViewingOriginal(true)}>
              <PhotoIcon /> See the original picture
            </button>
          ) : (
            <p className="detail-note">
              {sticker.originalSize
                ? 'The original picture is in your account. Sign in to see it here.'
                : "This sticker was made before the app kept the pictures stickers come from."}
            </p>
          )}

          {pages.length > 0 && (
            <>
              <h3 className="detail-heading">In your coloring books</h3>
              <ul className="detail-pages">
                {pages.map(({ book, page, folio }) => (
                  <li key={page.id}>
                    <button
                      className="detail-page"
                      onClick={() => onOpenPage(book.id, page.id)}
                      aria-label={`Open page ${folio} of ${book.title}`}
                    >
                      <span className="paper paper-small">
                        <img src={page.url} alt="" />
                      </span>
                      <span>
                        <strong>{book.title}</strong>
                        <small>Page {folio}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {viewingOriginal && (
        <OriginalViewer
          sticker={sticker}
          onLoad={onLoadOriginal}
          onClose={() => setViewingOriginal(false)}
          toast={toast}
        />
      )}

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

type OriginalState = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'missing' } | { kind: 'failed' }

/** The picture a sticker was made from, full screen, with its size and a way to save it. */
function OriginalViewer({
  sticker,
  onLoad,
  onClose,
  toast,
}: {
  sticker: Sticker
  onLoad?: () => Promise<Blob | null>
  onClose: () => void
  toast: (message: string) => void
}) {
  const [state, setState] = useState<OriginalState>({ kind: 'loading' })
  const [kept, setKept] = useState<{ width: number; height: number } | null>(null)
  const { original } = sticker
  // Callers pass a new function on every render; only whether there is one matters here.
  const load = useRef(onLoad)
  load.current = onLoad
  const canLoad = !!onLoad

  useEffect(() => {
    if (original) {
      const url = URL.createObjectURL(original)
      setState({ kind: 'ready', url })
      return () => URL.revokeObjectURL(url)
    }
    if (!load.current) {
      setState({ kind: 'missing' })
      return
    }
    // Once it arrives the sticker has it, and this runs again with `original` set.
    let cancelled = false
    setState({ kind: 'loading' })
    load
      .current()
      .then((blob) => !cancelled && !blob && setState({ kind: 'missing' }))
      .catch((err) => {
        console.error('Could not fetch the original picture', err)
        if (!cancelled) setState({ kind: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [original, canLoad])

  const size = sticker.originalSize
  const save = () => {
    if (!original) return
    try {
      downloadBlob(original, `original-${sticker.id.slice(0, 8)}.${EXTENSIONS[original.type] ?? 'jpg'}`)
    } catch {
      toast("Couldn't save the picture")
    }
  }

  return (
    <div className="original-viewer" role="dialog" aria-modal="true" aria-label="Original picture">
      <header className="original-bar">
        <span className="icon-btn-spacer" />
        <h2>Original picture</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close original picture">
          <CloseIcon />
        </button>
      </header>
      <div className="original-stage">
        {state.kind === 'ready' ? (
          <img
            src={state.url}
            alt="The picture this sticker was made from"
            onLoad={(e) => setKept({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          />
        ) : state.kind === 'loading' ? (
          <div className="spinner" aria-label="Loading the original picture" />
        ) : (
          <p className="original-message">
            {state.kind === 'missing'
              ? "The original picture didn't make it to your account, so it's only on the device that made this sticker."
              : "Couldn't load the original picture. Check your connection and try again."}
          </p>
        )}
      </div>
      <footer className="original-footer">
        <p>
          {size && <strong>{sizeLabel(size)}</strong>}
          {size && kept && kept.width < size.width && <small>Kept at {sizeLabel(kept)} to save space</small>}
        </p>
        <button className="btn btn-primary" onClick={save} disabled={!original}>
          <DownloadIcon /> Save
        </button>
      </footer>
    </div>
  )
}
