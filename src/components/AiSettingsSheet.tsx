import { useState } from 'react'
import {
  AI_ENGINES,
  AI_QUALITIES,
  engineById,
  hasKey,
  onServer,
  priceLabel,
  PROVIDERS,
  saveAiSettings,
  type AiQuality,
  type AiSettings,
} from '../lib/ai-coloring'
import { CloseIcon } from './icons'

interface Props {
  settings: AiSettings
  onSave: (settings: AiSettings) => void
  onClose: () => void
}

const QUALITY_LABELS: Record<AiQuality, string> = { low: 'Draft', medium: 'Good', high: 'Best' }

/** Where the person picks an AI model and connects their own accounts for AI-drawn pages. */
export function AiSettingsSheet({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(settings)
  const engine = engineById(draft.engine)
  const provider = PROVIDERS[engine.provider]
  const key = draft.keys[engine.provider]
  const serverKey = onServer(draft, engine)
  const [advanced, setAdvanced] = useState(!!draft.models[engine.id])

  const update = (patch: Partial<AiSettings>) => setDraft({ ...draft, ...patch })
  const save = (next: AiSettings) => {
    saveAiSettings(next)
    onSave(next)
  }

  return (
    <div className="sheet-backdrop ai-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet ai-sheet" role="dialog" aria-modal="true" aria-label="AI drawing settings">
        <header className="sheet-header">
          <span className="icon-btn-spacer" />
          <h2>AI drawing</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>

        <p className="ai-sheet-intro">
          An AI image model redraws your sticker as clean, professional line art.{' '}
          {draft.server
            ? 'Models marked “Ready” use the app’s own account. The others need your own key with the model’s provider, kept on this device.'
            : 'It uses your own account with the model’s provider, so you pay them per page. Keys stay on this device.'}{' '}
          Only the sticker you&rsquo;re drawing is sent.
        </p>

        <div className="ai-engines" role="radiogroup" aria-label="Model">
          {AI_ENGINES.map((e) => {
            const ready = hasKey(draft, e)
            const price = priceLabel(draft, e)
            return (
              <button
                key={e.id}
                role="radio"
                aria-checked={e.id === engine.id}
                className={`ai-engine${e.id === engine.id ? ' active' : ''}`}
                onClick={() => {
                  update({ engine: e.id })
                  setAdvanced(!!draft.models[e.id])
                }}
              >
                <span className="ai-engine-name">
                  {e.name}
                  {ready && <span className="ai-engine-ready">{onServer(draft, e) ? 'Ready' : 'Key added'}</span>}
                </span>
                <span className="ai-engine-blurb">{e.blurb}</span>
                {price && <span className="ai-engine-price">{price} a page</span>}
              </button>
            )
          })}
        </div>

        {serverKey ? (
          <p className="ai-hint">The app has its own {provider.name} key, so there&rsquo;s nothing to add here.</p>
        ) : (
          <>
            <label className="ai-field">
              <span>{provider.name} API key</span>
              <input
                type="password"
                value={key}
                onChange={(e) => update({ keys: { ...draft.keys, [engine.provider]: e.target.value } })}
                placeholder={provider.keyHint}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="ai-hint">
              Create one at{' '}
              <a href={provider.keyUrl} target="_blank" rel="noreferrer">
                {provider.keyUrl.replace('https://', '')}
              </a>
              . {provider.note}
            </p>
          </>
        )}

        {engine.provider === 'openai' && (
          <div className="segmented ai-quality" role="radiogroup" aria-label="Quality">
            <span className="segmented-label">Quality</span>
            {AI_QUALITIES.map((q) => (
              <button key={q} role="radio" aria-checked={draft.quality === q} className={draft.quality === q ? 'active' : ''} onClick={() => update({ quality: q })}>
                {QUALITY_LABELS[q]}
              </button>
            ))}
          </div>
        )}

        {advanced ? (
          <label className="ai-field">
            <span>Model name</span>
            <input
              value={draft.models[engine.id] ?? ''}
              onChange={(e) => update({ models: { ...draft.models, [engine.id]: e.target.value } })}
              placeholder={engine.model}
              spellCheck={false}
            />
          </label>
        ) : (
          <button className="btn btn-ghost ai-advanced" onClick={() => setAdvanced(true)}>
            Use a different model name…
          </button>
        )}

        <div className="sheet-actions">
          {settings.keys[engine.provider] && !serverKey && (
            <button className="btn btn-secondary" onClick={() => save({ ...draft, keys: { ...draft.keys, [engine.provider]: '' } })}>
              Remove key
            </button>
          )}
          <button className="btn btn-primary" onClick={() => save(draft)} disabled={!serverKey && !key.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
