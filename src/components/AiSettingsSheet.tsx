import { useState } from 'react'
import { AI_MODELS, AI_QUALITIES, priceLabel, saveAiSettings, type AiQuality, type AiSettings } from '../lib/ai-coloring'
import { CloseIcon } from './icons'

interface Props {
  settings: AiSettings
  onSave: (settings: AiSettings) => void
  onClose: () => void
}

const QUALITY_LABELS: Record<AiQuality, string> = { low: 'Draft', medium: 'Good', high: 'Best' }

/** Where the person connects their own OpenAI account for AI-drawn coloring pages. */
export function AiSettingsSheet({ settings, onSave, onClose }: Props) {
  const [key, setKey] = useState(settings.key)
  const [model, setModel] = useState(settings.model)
  const [quality, setQuality] = useState(settings.quality)
  const custom = !(AI_MODELS as readonly string[]).includes(model)
  const price = priceLabel({ model, quality })

  const save = (next: AiSettings) => {
    saveAiSettings(next)
    onSave(next)
  }

  return (
    <div
      className="sheet-backdrop ai-sheet-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet ai-sheet" role="dialog" aria-modal="true" aria-label="AI drawing settings">
        <header className="sheet-header">
          <span className="icon-btn-spacer" />
          <h2>AI drawing</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <p className="ai-sheet-intro">
          OpenAI&rsquo;s image model redraws your sticker as clean, professional line art. It uses your own
          OpenAI account, so you pay OpenAI per page. Your key stays on this device, and only the sticker
          you&rsquo;re drawing is sent to OpenAI.
        </p>

        <label className="ai-field">
          <span>OpenAI API key</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="ai-hint">
          Create one at{' '}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
            platform.openai.com/api-keys
          </a>
          . Image models need a verified organization and some credit on the account.
        </p>

        <div className="segmented ai-quality" role="radiogroup" aria-label="Quality">
          <span className="segmented-label">Quality</span>
          {AI_QUALITIES.map((q) => (
            <button key={q} role="radio" aria-checked={quality === q} className={quality === q ? 'active' : ''} onClick={() => setQuality(q)}>
              {QUALITY_LABELS[q]}
            </button>
          ))}
        </div>

        <label className="ai-field">
          <span>Model</span>
          <select value={custom ? 'custom' : model} onChange={(e) => setModel(e.target.value === 'custom' ? '' : e.target.value)}>
            {AI_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="custom">Other…</option>
          </select>
        </label>
        {custom && (
          <label className="ai-field">
            <span>Model name</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-image-…" spellCheck={false} />
          </label>
        )}
        <p className="ai-hint">{price ? `Each page costs ${price}.` : 'Check OpenAI’s pricing for this model.'}</p>

        <div className="sheet-actions">
          {settings.key && (
            <button className="btn btn-secondary" onClick={() => save({ key: '', model, quality })}>
              Remove key
            </button>
          )}
          <button className="btn btn-primary" onClick={() => save({ key, model, quality })} disabled={!key.trim() || !model.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
