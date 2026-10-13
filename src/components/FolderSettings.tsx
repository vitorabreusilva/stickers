import { useEffect, useState } from 'react'
import { FOLDER_COLOR_NAMES, FOLDER_COLORS, MAX_FOLDER_NAME, stickerCount, type FolderColor } from '../lib/folders'
import { CloseIcon, SparkleIcon } from './icons'

interface Props {
  /** The name it shows, and the one it would get automatically. */
  name: string
  autoName: string
  emoji: string
  count: number
  color: FolderColor
  onColor: (color: FolderColor) => void
  /** Missing for folders that can't be renamed. '' goes back to the automatic name. */
  onRename?: (name: string) => void
  /** Sorting the folder again with AI: missing when it can't be, `unavailable` says why it can't right now. */
  resort?: { run: () => void; busy: boolean; unavailable?: string }
  onClose: () => void
}

/** A folder's settings: its colour, its name, and sorting what's in it again. */
export function FolderSettings({ name, autoName, emoji, count, color, onColor, onRename, resort, onClose }: Props) {
  const [draft, setDraft] = useState(name)
  // Follow renames from elsewhere (another device) while nothing's being typed.
  useEffect(() => setDraft(name), [name])

  const commit = () => {
    const next = draft.trim()
    if (!onRename || next === name) return
    onRename(next === autoName ? '' : next)
  }

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && (commit(), onClose())}>
      <div className="sheet folder-settings" role="dialog" aria-modal="true" aria-label="Folder settings">
        <header className="sheet-header">
          <span className="icon-btn-spacer" />
          <h2>
            <span aria-hidden="true">{emoji}</span> {name}
          </h2>
          <button className="icon-btn" onClick={() => (commit(), onClose())} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <p className="folder-settings-count">{stickerCount(count)}</p>

        {onRename && (
          <form
            className="folder-settings-name"
            onSubmit={(e) => {
              e.preventDefault()
              commit()
              onClose()
            }}
          >
            <label htmlFor="folder-name">Name</label>
            {/* The reset sits inside the field, so the sheet doesn't change height (and move its buttons) on blur. */}
            <div className="folder-settings-field">
              <input
                id="folder-name"
                value={draft}
                maxLength={MAX_FOLDER_NAME}
                placeholder={autoName}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                enterKeyHint="done"
              />
              {name !== autoName && (
                <button
                  type="button"
                  className="folder-settings-reset"
                  aria-label={`Use “${autoName}”`}
                  onClick={() => {
                    setDraft(autoName)
                    onRename('')
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </form>
        )}

        <div className="folder-settings-row">
          <span className="folder-settings-label">Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Folder colour">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                className="swatch"
                data-color={c}
                role="radio"
                aria-checked={c === color}
                aria-label={FOLDER_COLOR_NAMES[c]}
                onClick={() => onColor(c)}
              />
            ))}
          </div>
        </div>

        {resort && (
          <div className="folder-settings-resort">
            <button className="btn btn-secondary" onClick={resort.run} disabled={resort.busy || !!resort.unavailable}>
              <SparkleIcon /> {resort.busy ? 'Sorting…' : 'Sort again with AI'}
            </button>
            <p>{resort.unavailable ?? 'The AI looks at these stickers again and puts each one where it fits best.'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
