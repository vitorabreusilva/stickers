import { EFFECT_INFO, EFFECTS, type StickerEffect } from '../lib/effects'
import { enableTilt } from '../lib/light'
import { StickerArt } from './StickerArt'

interface Props {
  /** The sticker to preview each effect on; null shows empty swatches while it's being cut. */
  image: { url: string; width: number; height: number } | null
  value: StickerEffect
  onChange: (effect: StickerEffect) => void
}

/** A row of swatches, each showing the actual sticker with one effect. */
export function EffectPicker({ image, value, onChange }: Props) {
  return (
    <div className="effect-picker" role="radiogroup" aria-label="Effect">
      {EFFECTS.map((effect) => (
        <button
          key={effect}
          role="radio"
          aria-checked={value === effect}
          className={`effect-swatch${value === effect ? ' active' : ''}`}
          disabled={!image}
          onClick={() => {
            // A tap is the only time iOS lets us ask for the motion sensors.
            if (effect !== 'none') enableTilt()
            onChange(effect)
          }}
        >
          <span className="effect-swatch-art">{image && <StickerArt image={image} effect={effect} />}</span>
          <span className="effect-swatch-name">{EFFECT_INFO[effect].name}</span>
        </button>
      ))}
    </div>
  )
}
