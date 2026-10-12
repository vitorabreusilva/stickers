import { useEffect, useState } from 'react'
import type { Point } from '../lib/geometry'
import type { LoadedImage } from '../lib/image'
import { createSticker, OUTLINE_SIZES, type OutlineSize, type StickerImage } from '../lib/sticker'
import { BackIcon } from './icons'

interface Props {
  image: LoadedImage
  loop: Point[]
  onBack: () => void
  onSave: (sticker: StickerImage) => Promise<void>
}

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
  const [sticker, setSticker] = useState<(StickerImage & { url: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    setError(null)
    createSticker(image, loop, outline)
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
  }, [image, loop, outline])

  const chooseOutline = (value: OutlineSize) => {
    setOutline(value)
    try {
      localStorage.setItem(OUTLINE_KEY, value)
    } catch {
      // Not remembering the choice is fine.
    }
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
          ) : sticker ? (
            <img key={sticker.url} className="preview-sticker" src={sticker.url} alt="Sticker preview" />
          ) : (
            <div className="spinner" aria-label="Cutting…" />
          )}
        </div>

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

        <div className="sheet-actions">
          <button className="btn btn-secondary" onClick={onBack}>
            Redraw
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!sticker || saving}>
            {saving ? 'Saving…' : 'Add to collection'}
          </button>
        </div>
      </div>
    </div>
  )
}
