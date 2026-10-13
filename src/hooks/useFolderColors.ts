import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collectionEvents, listFolders, saveFolder, type FolderRecord } from '../lib/db'
import { cleanFolderName, isFolderColor, type FolderColor, type FolderKey } from '../lib/folders'

/**
 * How the user dressed up folders, from IndexedDB: the colours they picked and the names they gave
 * them. `colors` is null while loading.
 */
export function useFolderColors() {
  const [records, setRecords] = useState<ReadonlyMap<string, FolderRecord> | null>(null)
  const recordsRef = useRef(records)
  recordsRef.current = records

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listFolders()
        .then((list) => {
          if (!cancelled) setRecords(new Map(list.map((r) => [r.key, r])))
        })
        .catch((err) => {
          console.error('Could not load folders', err)
          if (!cancelled) setRecords((current) => current ?? new Map())
        })
    load()
    // Synced in from another device.
    collectionEvents.addEventListener('remote', load)
    return () => {
      cancelled = true
      collectionEvents.removeEventListener('remote', load)
    }
  }, [])

  const colors = useMemo(
    () => records && new Map([...records.values()].flatMap((r) => (isFolderColor(r.color) ? [[r.key, r.color] as const] : []))),
    [records],
  )
  const names = useMemo(
    () => new Map([...(records?.values() ?? [])].flatMap((r) => (r.name ? [[r.key, r.name] as const] : []))),
    [records],
  )

  const save = useCallback(async (key: FolderKey, patch: Omit<FolderRecord, 'key'>) => {
    const next: FolderRecord = { ...recordsRef.current?.get(key), ...patch, key }
    if (!next.name) delete next.name
    // Show it straight away; the swatch should feel instant.
    setRecords((current) => new Map(current ?? []).set(key, next))
    await saveFolder(next)
  }, [])

  const setColor = useCallback((key: FolderKey, color: FolderColor) => save(key, { color }), [save])
  const setName = useCallback((key: FolderKey, name: string) => save(key, { name: cleanFolderName(name) }), [save])

  return { colors, names, setColor, setName }
}
