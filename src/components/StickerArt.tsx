import { useEffect, useMemo, type CSSProperties } from 'react'
import { EFFECT_INFO, effectOf, isAnimated, layerStyle, toneCss, type Light, type StickerEffect } from '../lib/effects'
import { watchLight } from '../lib/light'
import { installTextures } from '../lib/textures'

interface Props {
  image: { url: string; width: number; height: number }
  /** Missing on stickers saved before effects existed. */
  effect?: StickerEffect
  alt?: string
  className?: string
  /** Lets the sheen drift on its own when nothing moves it. For the sticker in focus. */
  idle?: boolean
  /** Freezes the effect under this light instead of following the live one. */
  light?: Light
  lazy?: boolean
}

/**
 * A sticker with its effect: the picture, color-adjusted, under foil layers masked to its shape.
 * It fills its box, keeping its proportions.
 */
export function StickerArt({ image, effect, alt = '', className, idle = false, light, lazy }: Props) {
  const fx = effectOf(effect)
  const { tone, layers } = EFFECT_INFO[fx]
  const live = !light && isAnimated(fx)

  useEffect(() => {
    if (layers.length) installTextures()
  }, [layers.length])

  useEffect(() => {
    if (live) return watchLight(idle)
  }, [live, idle])

  const mask = `url("${image.url}")`
  const layerStyles = useMemo(
    () =>
      layers.map(
        (layer): CSSProperties => ({
          ...layerStyle(layer, light),
          WebkitMaskImage: mask,
          maskImage: mask,
        }),
      ),
    [layers, light, mask],
  )

  return (
    <span className={`sticker-art${className ? ` ${className}` : ''}`} style={{ '--ar': image.width / image.height } as CSSProperties}>
      <span className="sticker-art-fx" data-effect={fx}>
        <img
          src={image.url}
          alt={alt}
          draggable={false}
          decoding="async"
          loading={lazy ? 'lazy' : undefined}
          style={tone.length ? { filter: toneCss(tone) } : undefined}
        />
        {layerStyles.map((style, i) => (
          <span key={i} className="sticker-art-layer" style={style} aria-hidden="true" />
        ))}
      </span>
    </span>
  )
}
