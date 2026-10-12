import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { getDb } from './db/client.js'
import { account, session, user, verification } from './db/schema.js'
import { isAllowed, requireEnv } from './env.js'

/** Google sign-in, with users and sessions in Postgres. `plugins` is for tests. */
export function createAuth(plugins: BetterAuthPlugin[] = []) {
  return betterAuth({
    // BETTER_AUTH_URL must be the address people use (it builds Google's redirect URL). On Vercel
    // it falls back to the production domain.
    baseURL:
      process.env.BETTER_AUTH_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
      undefined,
    secret: requireEnv('BETTER_AUTH_SECRET'),
    basePath: '/api/auth',
    database: drizzleAdapter(getDb(), { provider: 'pg', schema: { user, session, account, verification } }),
    socialProviders: {
      // Optional so the app runs locally before a Google client exists; signing in then just fails.
      ...(process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET && {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            prompt: 'select_account' as const,
          },
        }),
    },
    session: {
      // Stay signed in for months on a phone; the session is refreshed as the app is used.
      expiresIn: 60 * 60 * 24 * 90,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      user: {
        create: {
          // Only allowlisted people get an account. (Requests are checked again on every call, so
          // removing someone from the list locks them out straight away.)
          before: async (data) => {
            if (!isAllowed(data.email)) {
              throw new APIError('FORBIDDEN', { message: 'This Google account is not invited yet' })
            }
            return { data }
          },
        },
      },
    },
    plugins,
  })
}

export type Auth = ReturnType<typeof createAuth>

let auth: Auth | undefined

export function getAuth() {
  auth ??= createAuth()
  return auth
}
