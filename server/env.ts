export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. See .env.example.`)
  return value
}

/**
 * Whether `email` may sign in, per ALLOWED_EMAILS: a comma or space separated list, or "*" for
 * anyone. Unset or empty lets no one in, so a missing variable never opens the app to everybody.
 */
export function isAllowed(email: string, list = process.env.ALLOWED_EMAILS ?? '') {
  const allowed = list
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes('*') || allowed.includes(email.trim().toLowerCase())
}
