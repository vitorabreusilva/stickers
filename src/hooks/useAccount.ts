import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAccount, signOut as serverSignOut, type AccountState } from '../lib/account'
import { collectionEvents } from '../lib/db'
import { SignedOutError, syncOnce } from '../lib/sync'

export type SyncStatus =
  | { state: 'idle'; lastSynced: number | null }
  | { state: 'syncing'; lastSynced: number | null }
  | { state: 'offline'; lastSynced: number | null }
  | { state: 'error'; lastSynced: number | null }

/** Wait this long after an edit, so a burst of edits goes up together. */
const EDIT_DELAY = 1500
/** Check for changes from other devices this often while the app is open. */
const POLL_INTERVAL = 2 * 60_000

/** Who's signed in, and background sync while they are. */
export function useAccount() {
  const [account, setAccount] = useState<AccountState>({ status: 'loading' })
  const [sync, setSync] = useState<SyncStatus>({ state: 'idle', lastSynced: null })
  const running = useRef<Promise<void> | null>(null)
  const again = useRef(false)

  const refresh = useCallback(async () => setAccount(await fetchAccount()), [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const userEmail = account.status === 'signed-in' ? account.account.email : null

  const syncNow = useCallback(() => {
    if (!userEmail) return
    // One round at a time; edits made during a round get one more round after it.
    if (running.current) {
      again.current = true
      return
    }
    running.current = (async () => {
      do {
        again.current = false
        if (!navigator.onLine) {
          setSync((s) => ({ state: 'offline', lastSynced: s.lastSynced }))
          return
        }
        setSync((s) => ({ state: 'syncing', lastSynced: s.lastSynced }))
        try {
          await syncOnce(userEmail)
          setSync({ state: 'idle', lastSynced: Date.now() })
        } catch (err) {
          if (err instanceof SignedOutError) {
            await refresh()
            return
          }
          console.warn('Sync failed', err)
          setSync((s) => ({ state: navigator.onLine ? 'error' : 'offline', lastSynced: s.lastSynced }))
          return
        }
      } while (again.current)
    })().finally(() => {
      running.current = null
    })
  }, [userEmail, refresh])

  useEffect(() => {
    if (!userEmail) return
    syncNow()
    let timer: ReturnType<typeof setTimeout> | undefined
    const onEdit = () => {
      clearTimeout(timer)
      timer = setTimeout(syncNow, EDIT_DELAY)
    }
    const onVisible = () => document.visibilityState === 'visible' && syncNow()
    const poll = setInterval(onVisible, POLL_INTERVAL)
    collectionEvents.addEventListener('local', onEdit)
    window.addEventListener('online', syncNow)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      clearInterval(poll)
      collectionEvents.removeEventListener('local', onEdit)
      window.removeEventListener('online', syncNow)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userEmail, syncNow])

  const signOut = useCallback(async () => {
    await serverSignOut()
    setAccount({ status: 'signed-out' })
    setSync({ state: 'idle', lastSynced: null })
  }, [])

  return { account, sync, syncNow, signOut }
}
