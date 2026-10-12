// Signing in with Google, through the server's Better Auth routes.

import type { AccountInfo } from './sync-protocol'

export const api = (path: string) => `${import.meta.env.BASE_URL}api/${path}`

export type AccountState =
  | { status: 'loading' }
  /** No server here, e.g. an old static deployment: the app is local-only. */
  | { status: 'unavailable' }
  | { status: 'signed-out' }
  | { status: 'not-invited'; email?: string }
  | { status: 'signed-in'; account: AccountInfo }

const CACHE_KEY = 'stickers.account'

/** Who's signed in. When offline, falls back to who was signed in last time. */
export async function fetchAccount(): Promise<AccountState> {
  let response: Response
  try {
    response = await fetch(api('account'), { credentials: 'same-origin' })
  } catch {
    const cached = readCache()
    return cached ? { status: 'signed-in', account: cached } : { status: 'signed-out' }
  }
  if (response.status === 401) return forget({ status: 'signed-out' })
  if (response.status === 403) return forget({ status: 'not-invited' })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    return { status: 'unavailable' }
  }
  const account = (await response.json()) as AccountInfo
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(account))
  } catch {
    // Only matters for showing the account offline.
  }
  return { status: 'signed-in', account }
}

function readCache(): AccountInfo | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
  } catch {
    return null
  }
}

function forget<T>(state: T): T {
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // Nothing to forget.
  }
  return state
}

/** The param Better Auth adds when Google sign-in fails (e.g. the account isn't invited). */
export const SIGN_IN_ERROR_PARAM = 'error'

/** Sends the browser to Google. Comes back to the app, signed in or with ?error=… */
export async function signIn() {
  const home = new URL(import.meta.env.BASE_URL, location.origin).href
  const response = await fetch(api('auth/sign-in/social'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'google', callbackURL: home, errorCallbackURL: home }),
  })
  const { url } = (await response.json().catch(() => ({}))) as { url?: string }
  if (!response.ok || !url) throw new Error(`Sign-in failed (${response.status})`)
  location.assign(url)
}

export async function signOut() {
  await fetch(api('auth/sign-out'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  forget(null)
}
