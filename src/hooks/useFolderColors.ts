import { useCallback, useEffect, useState } from 'react'
import { listFolders, saveFolder } from '../lib/db'
import { isFolderColor, type FolderColor, type FolderKey } from '../lib/folders'

/** Colours the user picked for folders, from IndexedDB. null while loading. */
export function useFolderColors() {
  const [colors, setColors] = useState<ReadonlyMap<string, FolderColor> | null>(null)

  useEffect(() => {
    let cancelled = false
    listFolders()
      .then((records) => {
        if (cancelled) return
        setColors(new Map(records.filter((r) => isFolderColor(r.color)).map((r) => [r.key, r.color])))
      })
      .catch((err) => {
        console.error('Could not load folders', err)
        if (!cancelled) setColors(new Map())
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setColor = useCallback(async (key: FolderKey, color: FolderColor) => {
    // Show it straight away; the swatch should feel instant.
    setColors((current) => new Map(current ?? []).set(key, color))
    await saveFolder({ key, color })
  }, [])

  return { colors, setColor }
}
