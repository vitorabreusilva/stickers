import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent } from 'react'
import { firstImageFile } from '../lib/device'
import { groupByTopic, TOPICS, type TopicGroup, type TopicId } from '../lib/topics'
import type { Sticker } from '../hooks/useStickers'
import { PasteIcon, PlusIcon, StarMascot } from './icons'

interface Props {
  stickers: Sticker[] | null
  topics: Map<string, TopicId | undefined>
  /** Whether stickers are being sorted into topics right now. */
  sorting: boolean
  freshId: string | null
  canPaste: boolean
  onImage: (file: Blob) => void
  onPaste: () => void
  onOpen: (id: string) => void
}

type Filter = 'all' | TopicGroup<Sticker>['key']

/** A stable, slightly playful rotation per sticker so the grid looks hand-placed. */
function tilt(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return ((Math.abs(hash) % 15) - 7) * 0.9
}

function groupLabel(key: TopicGroup<Sticker>['key'], sorting: boolean) {
  if (key === 'new') return { emoji: '⏳', name: sorting ? 'Sorting…' : 'Not sorted yet' }
  return TOPICS[key]
}

export function Collection({ stickers, topics, sorting, freshId, canPaste, onImage, onPaste, onOpen }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const count = stickers?.length ?? 0
  const groups = useMemo(() => groupByTopic(stickers ?? [], topics), [stickers, topics])
  // A filter whose group emptied out (sticker deleted or moved) falls back to everything.
  const active: Filter = filter !== 'all' && groups.some((g) => g.key === filter) ? filter : 'all'
  const sections = active === 'all' ? groups : groups.filter((g) => g.key === active)
  // Headings only pay off once groups have a few stickers each; until then chips are enough.
  const showHeaders = active === 'all' && groups.length > 1 && count >= groups.length * 2

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = firstImageFile(e.target.files)
    e.target.value = ''
    if (file) onImage(file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = firstImageFile(e.dataTransfer.files)
    if (file) onImage(file)
  }


  const grid = (items: Sticker[], label: string) => (
    <ul className="grid" aria-label={label}>
      {items.map((sticker) => (
        <li key={sticker.id} style={{ '--tilt': `${tilt(sticker.id)}deg` } as CSSProperties}>
          <button
            className={`grid-item${sticker.id === freshId ? ' fresh' : ''}`}
            onClick={() => onOpen(sticker.id)}
            aria-label="Open sticker"
          >
            <img src={sticker.url} alt="" loading="lazy" decoding="async" draggable={false} />
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <div
      className="collection"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="collection-header">
        <h1>
          Stickers
          {count > 0 && <span className="count">{count}</span>}
        </h1>
      </header>

      {groups.length > 1 && (
        <nav className="chips" aria-label="Topics">
          <button className={`chip${active === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
            All <span>{count}</span>
          </button>
          {groups.map(({ key, items }) => {
            const { emoji, name } = groupLabel(key, sorting)
            return (
              <button key={key} className={`chip${active === key ? ' active' : ''}`} onClick={() => setFilter(key)}>
                {emoji} {name} <span>{items.length}</span>
              </button>
            )
          })}
        </nav>
      )}

      {stickers && count === 0 && (
        <section className="empty">
          <StarMascot />
          <h2>Your sticker book is empty</h2>
          <p>
            Pick a picture you love, draw a loop around the good part, and it becomes a sticker.
            {canPaste && ' You can also copy an image in your browser and paste it here.'}
          </p>
        </section>
      )}

      {count > 0 &&
        (showHeaders
          ? sections.map(({ key, items }) => {
              const { emoji, name } = groupLabel(key, sorting)
              return (
                <section key={key} className="topic-section">
                  <h2 className="topic-heading">
                    <span aria-hidden="true">{emoji}</span> {name} <span className="topic-count">{items.length}</span>
                  </h2>
                  {grid(items, name)}
                </section>
              )
            })
          : grid(
              active === 'all' ? stickers! : sections[0].items,
              active === 'all' ? 'Your stickers' : groupLabel(active, sorting).name,
            ))}

      <div className="dock">
        {canPaste && (
          <button className="btn btn-secondary" onClick={onPaste}>
            <PasteIcon /> Paste
          </button>
        )}
        <button className="btn btn-primary btn-big" onClick={() => inputRef.current?.click()}>
          <PlusIcon /> New sticker
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={onFile}
          hidden
          data-testid="file-input"
        />
      </div>

      {dragging && <div className="drop-hint">Drop an image to make a sticker</div>}
    </div>
  )
}
