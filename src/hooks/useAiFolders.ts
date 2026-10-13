import { useCallback, useEffect, useRef, useState } from 'react'
import { AiFolderError, aiFoldersPreferred, describeSticker, serverHasAiFolders, setAiFoldersPreferred, sortIntoFolders } from '../lib/ai-folders'
import type { StickerRecord } from '../lib/db'
import { groupRequest, MAX_GROUP_BATCH, needsDescription, needsFolder, type AiFolder, type StickerAi } from '../lib/smart-groups'

/** New stickers wait this long for others to arrive, so they're sorted together. */
const GROUP_DELAY = 1500

export type AiFolders = ReturnType<typeof useAiFolders>

type Save = (id: string, patch: { ai: StickerAi }) => Promise<void>

/**
 * AI folders, worked out in the background while signed in: each sticker is described once, then
 * described stickers that aren't in a folder are sorted into one, reusing the folders there are.
 * Everything it learns is saved on the stickers, so it syncs and is only ever done once.
 */
export function useAiFolders(stickers: StickerRecord[] | null, save: Save, signedIn: boolean) {
  const [preferred, setPreferred] = useState(aiFoldersPreferred)
  const [available, setAvailable] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [busy, setBusy] = useState<'describing' | 'sorting' | 'regrouping' | null>(null)
  const [tick, setTick] = useState(0)
  const working = useRef(false)
  // Stickers the AI couldn't describe or place this session, so they aren't asked about again.
  const skipDescribe = useRef(new Set<string>())
  const skipFolder = useRef(new Set<string>())
  const stickersRef = useRef(stickers)
  stickersRef.current = stickers

  useEffect(() => {
    const up = () => {
      setOnline(true)
      skipDescribe.current.clear()
      skipFolder.current.clear()
    }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    if (!signedIn || !online) return setAvailable(false)
    let live = true
    serverHasAiFolders().then((yes) => live && setAvailable(yes))
    return () => {
      live = false
    }
  }, [signedIn, online])

  const enabled = available && preferred

  /** Runs one piece of work at a time; a server that can't do AI folders stops them all. */
  const run = useCallback(async (kind: NonNullable<typeof busy>, job: () => Promise<void>) => {
    if (working.current) return false
    working.current = true
    setBusy(kind)
    try {
      await job()
      return true
    } catch (err) {
      if (err instanceof AiFolderError && err.kind === 'key') setAvailable(false)
      throw err
    } finally {
      working.current = false
      setBusy(null)
      setTick((t) => t + 1)
    }
  }, [])

  /** Files `batch` into folders, with what else is in `all`, and saves where each went. Returns the folders' names. */
  const sortBatch = useCallback(
    async (all: StickerRecord[], batch: StickerRecord[]) => {
      const { assignments } = await sortIntoFolders(groupRequest(all, batch), all.length)
      const placed = new Map(assignments.map((a) => [a.id, a]))
      const names = new Set<string>()
      for (const sticker of batch) {
        const where = placed.get(sticker.id)
        if (!where || !sticker.ai) {
          skipFolder.current.add(sticker.id)
          continue
        }
        const folder: AiFolder = { name: where.name, emoji: where.emoji }
        sticker.ai = { ...sticker.ai, folder }
        names.add(where.name)
        await save(sticker.id, { ai: sticker.ai })
      }
      return names
    },
    [save],
  )

  // Describe stickers one at a time, newest first, then sort the new ones into folders.
  useEffect(() => {
    if (!enabled || !stickers || working.current) return
    const next = stickers.find((s) => needsDescription(s) && !skipDescribe.current.has(s.id))
    if (next) {
      run('describing', async () => {
        try {
          const ai = await describeSticker(next.blob)
          // A folder it was put in by hand stays.
          await save(next.id, { ai: next.ai?.folder ? { ...ai, folder: next.ai.folder } : ai })
        } catch (err) {
          skipDescribe.current.add(next.id)
          throw err
        }
      }).catch((err) => console.warn('Could not describe a sticker', err))
      return
    }
    const unsorted = stickers.filter((s) => needsFolder(s) && !skipFolder.current.has(s.id))
    if (!unsorted.length) return
    const timer = setTimeout(() => {
      const all = (stickersRef.current ?? []).map((s) => ({ ...s }))
      const batch = all.filter((s) => needsFolder(s) && !skipFolder.current.has(s.id)).slice(0, MAX_GROUP_BATCH)
      if (!batch.length) return
      run('sorting', async () => void (await sortBatch(all, batch))).catch((err) => {
        batch.forEach((s) => skipFolder.current.add(s.id))
        console.warn('Could not sort stickers into folders', err)
      })
    }, GROUP_DELAY)
    return () => clearTimeout(timer)
  }, [enabled, stickers, run, save, sortBatch, tick])

  /**
   * Sorts the collection again from scratch, or just the stickers in `only`, except stickers placed
   * by hand. Says which folders they went in, or why nothing happened.
   */
  const regroup = useCallback(async (only?: ReadonlySet<string>): Promise<string[] | 'empty' | 'busy'> => {
    const all = (stickersRef.current ?? []).map((s) => ({ ...s }))
    const targets = all.filter((s) => s.ai && !s.topic && !s.ai.folder?.pinned && (!only || only.has(s.id)))
    if (!targets.length) return 'empty'
    // Forget their folders first, so later batches build on the new folders, not the old ones.
    for (const s of targets) {
      const { folder: _, ...rest } = s.ai!
      s.ai = rest
    }
    skipFolder.current.clear()
    const names = new Set<string>()
    const ran = await run('regrouping', async () => {
      for (let i = 0; i < targets.length; i += MAX_GROUP_BATCH) {
        for (const name of await sortBatch(all, targets.slice(i, i + MAX_GROUP_BATCH))) names.add(name)
      }
    })
    return ran ? [...names] : 'busy'
  }, [run, sortBatch])

  const setOn = useCallback((on: boolean) => {
    setAiFoldersPreferred(on)
    setPreferred(on)
  }, [])

  return {
    /** The server can make AI folders for this person. */
    available,
    /** …and they're turned on here. */
    enabled,
    preferred,
    setOn,
    busy,
    regroup,
  }
}
