import { useState } from 'react'
import { signIn, type AccountState } from '../lib/account'
import type { SyncStatus } from '../hooks/useAccount'
import { GoogleIcon } from './icons'

interface Props {
  account: AccountState
  sync: SyncStatus
  onSyncNow: () => void
  onSignOut: () => Promise<void>
  toast: (message: string) => void
}

function syncLabel(sync: SyncStatus) {
  switch (sync.state) {
    case 'syncing':
      return 'Syncing…'
    case 'offline':
      return "Offline. Changes will sync when you're back online."
    case 'error':
      return "Couldn't sync just now. It'll try again."
    case 'idle':
      if (!sync.lastSynced) return 'Ready to sync'
      return `Synced at ${new Date(sync.lastSynced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }
}

/** Signing in with Google, and how syncing is going. */
export function AccountSection({ account, sync, onSyncNow, onSignOut, toast }: Props) {
  const [leaving, setLeaving] = useState(false)

  const google = async () => {
    try {
      setLeaving(true)
      await signIn()
    } catch (err) {
      console.error('Could not start sign-in', err)
      setLeaving(false)
      toast("Couldn't reach Google. Check your connection.")
    }
  }

  const signInButton = (label: string) => (
    <button className="btn btn-secondary google-btn" onClick={google} disabled={leaving}>
      <GoogleIcon /> {label}
    </button>
  )

  switch (account.status) {
    case 'unavailable':
      return null
    case 'loading':
      return <p className="backup-text">Checking your account…</p>
    case 'signed-out':
      return (
        <section className="account" aria-label="Account">
          <p className="backup-text">
            Sign in to keep your collection in sync on your phone, tablet and computer. Everything still works offline.
          </p>
          {signInButton('Sign in with Google')}
        </section>
      )
    case 'not-invited':
      return (
        <section className="account" aria-label="Account">
          <p className="backup-text">That Google account isn&rsquo;t invited yet. Your stickers are still saved on this device.</p>
          {signInButton('Use another account')}
        </section>
      )
    case 'signed-in': {
      const { name, email, image } = account.account
      return (
        <section className="account" aria-label="Account">
          <div className="account-who">
            {image ? (
              <img className="account-avatar" src={image} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="account-avatar">{(name || email).slice(0, 1).toUpperCase()}</span>
            )}
            <span className="account-name">
              <strong>{name || email}</strong>
              <span>{email}</span>
            </span>
          </div>
          <p className="account-status" role="status">
            {syncLabel(sync)}
          </p>
          <div className="sheet-actions">
            <button className="btn btn-secondary" onClick={() => onSignOut().catch(() => toast("Couldn't sign out"))}>
              Sign out
            </button>
            <button className="btn btn-primary" onClick={onSyncNow} disabled={sync.state === 'syncing'}>
              Sync now
            </button>
          </div>
        </section>
      )
    }
  }
}
