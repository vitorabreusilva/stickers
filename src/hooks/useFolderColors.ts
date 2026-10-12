import { useCallback, useEffect, useState } from 'react'
import { collectionEvents, listFolders, saveFolder } from '../lib/db'
import { isFolderColor, type FolderColor, type FolderKey } from '../lib/folders'

/** Colours the user picked for folders, from IndexedDB. null while loading. */
export function useFolderColors() {
  const [colors, setColors] = useState<ReadonlyMap<string, FolderColor> | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listFolders()
        .then((records) => {
          if (cancelled) return
          setColors(new Map(records.filter((r) => isFolderColor(r.color)).map((r) => [r.key, r.color])))
        })
        .catch((err) => {
          console.error('Could not load folders', err)
          if (!cancelled) setColors((current) => current ?? new Map())
        })
    load()
    // Synced in from another device.
    collectionEvents.addEventListener('remote', load)
    return () => {
      cancelled = true
      collectionEvents.removeEventListener('remote', load)
    }
  }, [])

  const setColor = useCallback(async (key: FolderKey, color: FolderColor) => {
    // Show it straight away; the swatch should feel instant.
    setColors((current) => new Map(current ?? []).set(key, color))
    await saveFolder({ key, color })
  }, [])

  return { colors, setColor }
}
