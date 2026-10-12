import { useEffect, useRef, useState } from 'react'
import { analyzeSticker } from '../lib/analysis'
import type { StickerRecord } from '../lib/db'
import { ANALYSIS_VERSION, type StickerAnalysis } from '../lib/topics'

const needsAnalysis = (s: StickerRecord) => !s.analysis || s.analysis.version < ANALYSIS_VERSION

/**
 * Analyses stickers in the background, one at a time, so they can be grouped by topic. Returns
 * whether it's working through some right now. Failures (e.g. offline before the models were
 * ever downloaded) are retried when the connection comes back.
 */
export function useAutoAnalysis(
  stickers: StickerRecord[] | null,
  save: (id: string, patch: { analysis: StickerAnalysis }) => Promise<void>,
): boolean {
  const busy = useRef(false)
  const failed = useRef(new Set<string>())
  const [tick, setTick] = useState(0)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    const retry = () => {
      failed.current.clear()
      setTick((t) => t + 1)
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [])

  useEffect(() => {
    if (!stickers || busy.current) return
    const next = stickers.find((s) => needsAnalysis(s) && !failed.current.has(s.id))
    setWorking(!!next)
    if (!next) return
    busy.current = true
    analyzeSticker(next.blob)
      .then((analysis) => save(next.id, { analysis }))
      .catch((err) => {
        console.warn('Could not analyse sticker', err)
        failed.current.add(next.id)
      })
      .finally(() => {
        busy.current = false
        setTick((t) => t + 1)
      })
  }, [stickers, save, tick])

  return working
}
