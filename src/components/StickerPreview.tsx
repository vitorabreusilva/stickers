import { useEffect, useState } from 'react'
import { cutoutFor, cutoutPreferred, setCutoutPreferred, type CutoutStatus } from '../lib/cutout'
import type { Point } from '../lib/geometry'
import type { LoadedImage } from '../lib/image'
import { createSticker, OUTLINE_SIZES, type OutlineSize, type Selection, type StickerImage } from '../lib/sticker'
import { BackIcon, SparkleIcon } from './icons'

interface Props {
  image: LoadedImage
  loop: Point[]
  onBack: () => void
  onSave: (sticker: StickerImage) => Promise<void>
}

type Cutout =
  | { kind: 'off' }
  | { kind: 'working'; status: CutoutStatus }
  | { kind: 'done'; selection: Selection }
  | { kind: 'failed'; message: string }

const OUTLINE_KEY = 'stickers.outline'
const OUTLINE_LABELS: Record<OutlineSize, string> = { none: 'None', thin: 'Thin', thick: 'Thick' }

function savedOutline(): OutlineSize {
  try {
    const value = localStorage.getItem(OUTLINE_KEY)
    if (value && (OUTLINE_SIZES as string[]).includes(value)) return value as OutlineSize
  } catch {
    // Storage can be unavailable (private mode); fall through to the default.
  }
  return 'thick'
}

export function StickerPreview({ image, loop, onBack, onSave }: Props) {
  const [outline, setOutline] = useState<OutlineSize>(savedOutline)
  const [removeBg, setRemoveBg] = useState(cutoutPreferred)
  const [cutout, setCutout] = useState<Cutout>(() =>
    removeBg ? { kind: 'working', status: { stage: 'cutting' } } : { kind: 'off' },
  )
  const [sticker, setSticker] = useState<(StickerImage & { url: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!removeBg) {
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
  }, [image, loop, removeBg])

  useEffect(() => {
    if (cutout.kind === 'working') {
      setSticker(null)
      return
    }
    let cancelled = false
    let url: string | undefined
    setError(null)
    createSticker(image, loop, outline, cutout.kind === 'done' ? cutout.selection : undefined)
      .then((result) => {
        if (cancelled) return
        url = URL.createObjectURL(result.blob)
        setSticker({ ...result, url })
      })
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [image, loop, outline, cutout])

  const chooseOutline = (value: OutlineSize) => {
    setOutline(value)
    try {
      localStorage.setItem(OUTLINE_KEY, value)
    } catch {
      // Not remembering the choice is fine.
    }
  }

  const toggleRemoveBg = () => {
    setRemoveBg(!removeBg)
    setCutoutPreferred(!removeBg)
  }

  const save = async () => {
    if (!sticker || saving) return
    setSaving(true)
    try {
      await onSave(sticker)
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
          <h2>Your new sticker</h2>
          <span className="icon-btn-spacer" />
        </header>

        <div className="preview-stage">
          {error ? (
            <p className="preview-error">{error}</p>
          ) : cutout.kind === 'working' ? (
            <CutoutProgress status={cutout.status} />
          ) : sticker ? (
            <img key={sticker.url} className="preview-sticker" src={sticker.url} alt="Sticker preview" />
          ) : (
            <div className="spinner" aria-label="Cutting…" />
          )}
        </div>
        <p className="preview-note" role="status">
          {cutout.kind === 'failed' ? cutout.message : ''}
        </p>

        <div className="preview-options">
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
        </div>

        <div className="sheet-actions">
          <button className="btn btn-secondary" onClick={onBack}>
            Redraw
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!sticker || saving || cutout.kind === 'working'}>
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
