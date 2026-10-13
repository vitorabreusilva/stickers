import type { AiFolders } from '../hooks/useAiFolders'
import { SparkleIcon } from './icons'

const BUSY = {
  describing: 'Looking at your stickers…',
  sorting: 'Sorting new stickers into folders…',
  regrouping: 'Sorting stickers again…',
}

/** Turning AI folders on and off, and sorting everything again. Shown when the server can make them. */
export function AiFoldersSection({ aiFolders, toast }: { aiFolders: AiFolders; toast: (message: string) => void }) {
  const { preferred, enabled, busy, setOn, regroup } = aiFolders

  const regroupAll = async () => {
    try {
      const result = await regroup()
      toast(
        result === 'busy'
          ? 'The AI is still busy. Try again in a moment.'
          : result === 'empty'
            ? 'Nothing to sort yet. Give the AI a moment to look at your stickers.'
            : 'Sorted into new folders!',
      )
    } catch {
      toast("Couldn't sort the stickers. Try again in a moment.")
    }
  }

  return (
    <section className="ai-folders" aria-label="AI folders">
      <p className="backup-text">
        An AI model looks at each sticker and sorts your collection into folders named after what you collect, like a
        favourite show or character. Your stickers are sent to Google or OpenAI for this.
      </p>
      <button className="switch-row ai-folders-switch" role="switch" aria-checked={preferred} onClick={() => setOn(!preferred)}>
        <SparkleIcon />
        <span>AI folders</span>
        <span className="switch" aria-hidden="true" />
      </button>
      {enabled && (
        <>
          <p className="account-status" role="status">
            {busy ? BUSY[busy] : 'New stickers are sorted as you add them.'}
          </p>
          <button className="btn btn-secondary" onClick={regroupAll} disabled={!!busy}>
            Sort everything again
          </button>
        </>
      )}
    </section>
  )
}
