import { useEffect, useRef, useState } from 'react'
import { loadAiSettings, priceLabel, type AiSettings } from '../lib/ai-coloring'
import { composePage, drawAiColoringArt, drawColoringArt, pagesToPdf, printPages } from '../lib/book-render'
import { COLORING_DETAILS, type ColoringDetail } from '../lib/coloring'
import { newId, type BookPageRecord } from '../lib/db'
import { downloadBlob } from '../lib/device'
import { canvasToBlob } from '../lib/image'
import type { Sticker } from '../hooks/useStickers'
import { AiSettingsSheet } from './AiSettingsSheet'
import { BackIcon, BookIcon, DownloadIcon, PrintIcon, SparkleIcon } from './icons'

interface Props {
  sticker: Sticker
  onAdd: (page: Omit<BookPageRecord, 'position'>) => Promise<void>
  onOpenBook: () => void
  onClose: () => void
  toast: (message: string) => void
}

const DETAIL_KEY = 'stickers.coloringDetail'
const ENGINE_KEY = 'stickers.coloringEngine'
const GUIDE_KEY = 'stickers.colorGuide'
const DETAIL_LABELS: Record<ColoringDetail, string> = { simple: 'Simple', medium: 'Medium', detailed: 'Detailed' }

/** Who draws the page: OpenAI's image model, or the free tracer on the device. */
type Engine = 'ai' | 'free'

function saved<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    if (value && (allowed as readonly string[]).includes(value)) return value as T
  } catch {
    // Storage can be unavailable (private mode); fall through to the default.
  }
  return fallback
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembering the choice is fine.
  }
}

/** Turns a sticker into an A5 coloring page to print, save, or add to the coloring book. */
export function ColoringStudio({ sticker, onAdd, onOpenBook, onClose, toast }: Props) {
  const [detail, setDetail] = useState<ColoringDetail>(() => saved(DETAIL_KEY, COLORING_DETAILS, 'medium'))
  const [engine, setEngine] = useState<Engine>(() => saved(ENGINE_KEY, ['ai', 'free'] as Engine[], 'ai'))
  const [ai, setAi] = useState<AiSettings>(loadAiSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [guide, setGuide] = useState(() => saved(GUIDE_KEY, ['on', 'off'], 'on') === 'on')
  const [page, setPage] = useState<{ blob: Blob; url: string; key: string } | null>(null)
  const [working, setWorking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<'pdf' | 'add' | null>(null)
  // Line art per detail level, so flipping back and forth doesn't redraw it. AI drawings cost
  // money, so they're only made when asked for, and kept.
  const arts = useRef(new Map<ColoringDetail, Promise<HTMLCanvasElement>>())
  const aiArts = useRef(new Map<ColoringDetail, Promise<HTMLCanvasElement>>())
  const aiAbort = useRef<AbortController | null>(null)
  const [aiVersion, setAiVersion] = useState(0)
  const [aiDrawing, setAiDrawing] = useState(false)

  // AI mode before the AI has drawn this detail level: show the free drawing as a preview.
  const aiArt = engine === 'ai' ? aiArts.current.get(detail) : undefined
  const awaitingAi = engine === 'ai' && !aiArt
  const key = `${aiArt ? 'ai' : 'free'}:${detail}:${guide}`

  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    setWorking(true)
    setError(null)
    let art = aiArt ?? arts.current.get(detail)
    if (!art) {
      art = drawColoringArt(sticker.blob, detail)
      arts.current.set(detail, art)
      art.catch(() => arts.current.delete(detail))
    }
    art
      .then((canvas) => composePage(canvas, guide ? sticker.blob : null))
      .then((canvas) => canvasToBlob(canvas))
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setPage({ blob, url, key })
        setWorking(false)
      })
      .catch((err) => {
        if (cancelled || aiArt) return
        console.error('Could not make the coloring page', err)
        setError("Couldn't draw this one. Try another detail level.")
        setWorking(false)
      })
    return () => {
      cancelled = true
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000)
    }
  }, [sticker.blob, detail, guide, key, aiArt, aiVersion])

  useEffect(() => () => aiAbort.current?.abort(), [])

  const drawWithAi = () => {
    if (!ai.key) {
      setSettingsOpen(true)
      return
    }
    aiAbort.current?.abort()
    const controller = new AbortController()
    aiAbort.current = controller
    const forDetail = detail
    const art = drawAiColoringArt(sticker.blob, forDetail, ai, controller.signal)
    aiArts.current.set(forDetail, art)
    setAiError(null)
    setAiDrawing(true)
    setAiVersion((v) => v + 1)
    art
      .catch((err: Error) => {
        aiArts.current.delete(forDetail)
        if (controller.signal.aborted) return
        console.error('AI drawing failed', err)
        setAiError(err.message || 'The AI drawing failed. Try again.')
      })
      .finally(() => {
        if (aiAbort.current !== controller) return
        setAiDrawing(false)
        setAiVersion((v) => v + 1)
      })
  }

  const cancelAi = () => {
    aiAbort.current?.abort()
    aiAbort.current = null
    aiArts.current.delete(detail)
    setAiDrawing(false)
    setAiVersion((v) => v + 1)
  }

  const chooseEngine = (value: Engine) => {
    setEngine(value)
    remember(ENGINE_KEY, value)
    setAiError(null)
  }

  const chooseDetail = (value: ColoringDetail) => {
    setDetail(value)
    remember(DETAIL_KEY, value)
    setAiError(null)
  }

  const toggleGuide = () => {
    setGuide(!guide)
    remember(GUIDE_KEY, guide ? 'off' : 'on')
  }

  const ready = page && page.key === key && !working && !awaitingAi && !aiDrawing
  const price = priceLabel(ai)
  const isAdded = added.has(key)

  const savePdf = async () => {
    if (!ready || busy) return
    setBusy('pdf')
    try {
      downloadBlob(await pagesToPdf([page.blob]), `coloring-page-${sticker.id.slice(0, 8)}.pdf`)
    } catch (err) {
      console.error(err)
      toast("Couldn't make the PDF")
    } finally {
      setBusy(null)
    }
  }

  const print = () => {
    if (!ready) return
    printPages([page.url]).catch(() => toast("Couldn't open printing"))
  }

  const add = async () => {
    if (!ready || busy || isAdded) return
    setBusy('add')
    try {
      await onAdd({
        id: newId(),
        stickerId: sticker.id,
        sticker: sticker.blob,
        ...(sticker.effect && sticker.effect !== 'none' && { effect: sticker.effect }),
        page: page.blob,
        detail,
        createdAt: Date.now(),
      })
      setAdded(new Set(added).add(key))
      toast('Added to your coloring book!')
    } catch (err) {
      console.error(err)
      toast("Couldn't add the page. Is your storage full?")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="book-screen" role="dialog" aria-modal="true" aria-label="Coloring page">
      <div className="book-screen-inner">
        <header className="book-bar">
          <button className="icon-btn book-bar-btn" onClick={onClose} aria-label="Back">
            <BackIcon />
          </button>
          <h2>
            Coloring page <span className="beta">Beta</span>
          </h2>
          <button className="icon-btn book-bar-btn" onClick={onOpenBook} aria-label="Open coloring book">
            <BookIcon />
          </button>
        </header>

        <div className="paper-stage">
          <div className={`paper${working || awaitingAi || aiDrawing ? ' working' : ''}`}>
            {page && (
              <img
                src={page.url}
                alt="Coloring page preview"
                data-testid="coloring-page"
                data-engine={page.key.split(':')[0]}
              />
            )}
            {aiDrawing ? (
              <div className="paper-status" role="status">
                <div className="scissors-spin" aria-hidden="true">
                  <SparkleIcon />
                </div>
                <p>
                  Drawing with AI…
                  <small>Usually 20–60 seconds</small>
                </p>
                <button className="btn btn-secondary paper-status-btn" onClick={cancelAi}>
                  Cancel
                </button>
              </div>
            ) : awaitingAi ? (
              <div className="paper-status">
                {aiError && <p className="paper-error" role="alert">{aiError}</p>}
                <button className="btn btn-primary paper-status-btn" onClick={drawWithAi}>
                  <SparkleIcon /> {ai.key ? (aiError ? 'Try again' : 'Draw with AI') : 'Set up AI drawing'}
                </button>
                <p>
                  <small>
                    {ai.key
                      ? `Professional line art by OpenAI${price ? `, ${price} a page` : ''}`
                      : 'Uses your own OpenAI API key'}
                  </small>
                </p>
              </div>
            ) : working ? (
              <div className="paper-status" role="status">
                <div className="scissors-spin" aria-hidden="true">
                  <SparkleIcon />
                </div>
                <p>Drawing the lines…</p>
              </div>
            ) : (
              error && <p className="paper-status preview-error">{error}</p>
            )}
          </div>
          <p className="paper-size">A5 · 148 × 210 mm</p>
        </div>

        <div className="preview-options">
          <div className="engine-row">
            <div className="segmented" role="radiogroup" aria-label="Drawn by">
              <button
                role="radio"
                aria-checked={engine === 'ai'}
                className={engine === 'ai' ? 'active' : ''}
                onClick={() => chooseEngine('ai')}
              >
                ✨ AI
              </button>
              <button
                role="radio"
                aria-checked={engine === 'free'}
                className={engine === 'free' ? 'active' : ''}
                onClick={() => chooseEngine('free')}
              >
                Free
              </button>
            </div>
            {engine === 'ai' && (
              <button className="btn btn-ghost engine-settings" onClick={() => setSettingsOpen(true)}>
                AI settings
              </button>
            )}
            {engine === 'ai' && aiArt && !aiDrawing && (
              <button className="btn btn-ghost engine-settings" onClick={drawWithAi}>
                Redraw
              </button>
            )}
          </div>
          <div className="segmented" role="radiogroup" aria-label="Detail">
            <span className="segmented-label">Detail</span>
            {COLORING_DETAILS.map((value) => (
              <button
                key={value}
                role="radio"
                aria-checked={detail === value}
                className={detail === value ? 'active' : ''}
                onClick={() => chooseDetail(value)}
              >
                {DETAIL_LABELS[value]}
              </button>
            ))}
          </div>
          <button className="switch-row" role="switch" aria-checked={guide} onClick={toggleGuide}>
            <SparkleIcon />
            <span>Color guide in the corner</span>
            <span className="switch" aria-hidden="true" />
          </button>
        </div>

        <div className="book-actions">
          <button className="btn btn-secondary" onClick={print} disabled={!ready}>
            <PrintIcon /> Print
          </button>
          <button className="btn btn-secondary" onClick={savePdf} disabled={!ready || busy !== null}>
            <DownloadIcon /> {busy === 'pdf' ? 'Saving…' : 'PDF'}
          </button>
          {isAdded ? (
            <button className="btn btn-primary" onClick={onOpenBook}>
              <BookIcon /> Open book
            </button>
          ) : (
            <button className="btn btn-primary" onClick={add} disabled={!ready || busy !== null}>
              <BookIcon /> {busy === 'add' ? 'Adding…' : 'Add to book'}
            </button>
          )}
        </div>
      </div>

      {settingsOpen && (
        <AiSettingsSheet
          settings={ai}
          onSave={(next) => {
            setAi(next)
            setSettingsOpen(false)
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
