import { useEffect, useState } from 'react'
import { cutoutFor, cutoutPreferred, setCutoutPreferred, type CutoutStatus } from '../lib/cutout'
import { effectOf, type StickerEffect } from '../lib/effects'
import type { Point } from '../lib/geometry'
import type { LoadedImage } from '../lib/image'
import { createStamp, STICKER_KINDS, type StickerKind } from '../lib/stamp'
import { createSticker, OUTLINE_SIZES, type OutlineSize, type Selection, type StickerImage } from '../lib/sticker'
import { EffectPicker } from './EffectPicker'
import { BackIcon, SparkleIcon } from './icons'
import { StickerArt } from './StickerArt'

interface Props {
  image: LoadedImage
  loop: Point[]
  onBack: () => void
  onSave: (sticker: StickerImage, effect: StickerEffect, kind: StickerKind) => Promise<void>
}

type Cutout =
  | { kind: 'off' }
  | { kind: 'working'; status: CutoutStatus }
  | { kind: 'done'; selection: Selection }
  | { kind: 'failed'; message: string }

const OUTLINE_KEY = 'stickers.outline'
const EFFECT_KEY = 'stickers.effect'
const OUTLINE_LABELS: Record<OutlineSize, string> = { none: 'None', thin: 'Thin', thick: 'Thick' }
const KIND_LABELS: Record<StickerKind, string> = { cutout: 'Sticker', stamp: 'Stamp' }

function savedOutline(): OutlineSize {
  try {
    const value = localStorage.getItem(OUTLINE_KEY)
    if (value && (OUTLINE_SIZES as string[]).includes(value)) return value as OutlineSize
  } catch {
    // Storage can be unavailable (private mode); fall through to the default.
  }
  return 'thick'
}

function savedEffect(): StickerEffect {
  try {
    return effectOf(localStorage.getItem(EFFECT_KEY))
  } catch {
    return 'none'
  }
}

export function StickerPreview({ image, loop, onBack, onSave }: Props) {
  const [outline, setOutline] = useState<OutlineSize>(savedOutline)
  const [effect, setEffect] = useState<StickerEffect>(savedEffect)
  const [kind, setKind] = useState<StickerKind>('cutout')
  const [removeBg, setRemoveBg] = useState(cutoutPreferred)
  // Stamps keep the whole picture, so there's no background to remove.
  const cutting = kind === 'cutout' && removeBg
  const [cutout, setCutout] = useState<Cutout>(() =>
    cutting ? { kind: 'working', status: { stage: 'cutting' } } : { kind: 'off' },
  )
  // Tagged with what it was made with: making a new one takes a moment, and until then the old one
  // must not be saved as if it were the new one.
  const [sticker, setSticker] = useState<
    (StickerImage & { url: string; kind: StickerKind; outline: OutlineSize; cutout: Cutout }) | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!cutting) {
      setCutout({ kind: 'off' })
      return
    }
    let cancelled = false
    const job = cutoutFor(image, loop)
    const finish = (selection: Selection | null) =>
      setCutout(
        selection
          ? { kind: 'done', selection }
          : { kind: 'failed', message: "Couldn't spot a clear subject, so here's your loop as drawn." },
      )
    if (job.result) {
      finish(job.result.selection)
      return
    }
    setCutout({ kind: 'working', status: job.status })
    const unsubscribe = job.subscribe((status) => setCutout({ kind: 'working', status }))
    job.promise
      .then((selection) => !cancelled && finish(selection))
      .catch((err) => {
        console.error('Background removal failed', err)
        if (cancelled) return
        setCutout({
          kind: 'failed',
          message: navigator.onLine
            ? "Background removal didn't work on this device, so here's your loop as drawn."
            : 'Background removal needs an internet connection the first time.',
        })
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [image, loop, cutting])

  useEffect(() => {
    if (cutout.kind === 'working') {
      setSticker(null)
      return
    }
    let cancelled = false
    let url: string | undefined
    setError(null)
    const made =
      kind === 'stamp'
        ? createStamp(image, loop)
        : createSticker(image, loop, outline, cutout.kind === 'done' ? cutout.selection : undefined)
    made
      .then((result) => {
        if (cancelled) return
        url = URL.createObjectURL(result.blob)
        setSticker({ ...result, url, kind, outline, cutout })
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [image, loop, outline, cutout, kind])

  const chooseOutline = (value: OutlineSize) => {
    setOutline(value)
    try {
      localStorage.setItem(OUTLINE_KEY, value)
    } catch {
      // Not remembering the choice is fine.
    }
  }

  const chooseEffect = (value: StickerEffect) => {
    setEffect(value)
    try {
      localStorage.setItem(EFFECT_KEY, value)
    } catch {
      // Not remembering the choice is fine.
    }
  }

  const toggleRemoveBg = () => {
    setRemoveBg(!removeBg)
    setCutoutPreferred(!removeBg)
  }

  // A sticker shows until the next one is ready, unless it's the other style: a stamp isn't a sticker.
  const shown = sticker?.kind === kind ? sticker : null
  const current = shown && shown.outline === outline && shown.cutout === cutout ? shown : null

  const save = async () => {
    if (!current || saving) return
    setSaving(true)
    try {
      await onSave(current, effect, kind)
    } catch (err) {
      console.error(err)
      setError('Could not save the sticker. Is your storage full?')
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Sticker preview">
      <div className="sheet">
        <header className="sheet-header">
          <button className="icon-btn" onClick={onBack} aria-label="Back to drawing">
            <BackIcon />
          </button>
          <h2>Your new {kind === 'stamp' ? 'stamp' : 'sticker'}</h2>
          <span className="icon-btn-spacer" />
        </header>

        <div className="preview-stage">
          {error ? (
            <p className="preview-error">{error}</p>
          ) : cutout.kind === 'working' ? (
            <CutoutProgress status={cutout.status} />
          ) : shown ? (
            <StickerArt key={shown.url} className="preview-sticker" image={shown} effect={effect} alt="Sticker preview" idle />
          ) : (
            <div className="spinner" aria-label="Cutting…" />
          )}
        </div>
        <p className="preview-note" role="status">
          {kind === 'stamp'
            ? 'The whole area you circled, background and all, in a stamp frame.'
            : cutout.kind === 'failed'
              ? cutout.message
              : ''}
        </p>

        <div className="preview-options">
          <div className="segmented" role="radiogroup" aria-label="Style">
            <span className="segmented-label">Style</span>
            {STICKER_KINDS.map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={kind === value}
                className={kind === value ? 'active' : ''}
                onClick={() => setKind(value)}
              >
                {KIND_LABELS[value]}
              </button>
            ))}
          </div>

          {kind === 'cutout' && (
            <>
              <button className="switch-row" role="switch" aria-checked={removeBg} onClick={toggleRemoveBg}>
                <SparkleIcon />
                <span>Remove background</span>
                <span className="switch" aria-hidden="true" />
              </button>

              <div className="segmented" role="radiogroup" aria-label="Border">
                <span className="segmented-label">Border</span>
                {OUTLINE_SIZES.map((size) => (
                  <button
                    key={size}
                    role="radio"
                    aria-checked={outline === size}
                    className={outline === size ? 'active' : ''}
                    onClick={() => chooseOutline(size)}
                  >
                    {OUTLINE_LABELS[size]}
                  </button>
                ))}
              </div>
            </>
          )}

          <EffectPicker image={cutout.kind === 'working' || error ? null : shown} value={effect} onChange={chooseEffect} />
        </div>

        <div className="sheet-actions">
          <button className="btn btn-secondary" onClick={onBack}>
            Redraw
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!current || saving || cutout.kind === 'working'}>
            {saving ? 'Saving…' : 'Add to collection'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CutoutProgress({ status }: { status: CutoutStatus }) {
  if (status.stage === 'download') {
    const percent = Math.round(status.fraction * 100)
    return (
      <div className="cutout-progress">
        <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <p>
          Getting the magic scissors ready…
          <small>
            {percent}% · one-time download, up to {Math.ceil(__CUTOUT_BYTES__ / 1e6)} MB
          </small>
        </p>
      </div>
    )
  }
  return (
    <div className="cutout-progress">
      <div className="scissors-spin" aria-hidden="true">
        <SparkleIcon />
      </div>
      <p>Cutting out your sticker…</p>
    </div>
  )
}
