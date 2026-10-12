import { Hono } from 'hono'
import type { AccountInfo } from '../src/lib/sync-protocol.js'
import { aiRoutes } from './ai.js'
import { getAuth, type Auth } from './auth.js'
import { groupingRoutes } from './grouping.js'
import { isAllowed } from './env.js'
import { syncRoutes, type SignedIn } from './sync.js'

/** The whole API under /api. `auth` is swappable for tests. */
export function createApp(auth: () => Auth = getAuth) {
  const app = new Hono<SignedIn>().basePath('/api')

  app.on(['GET', 'POST'], '/auth/*', (c) => auth().handler(c.req.raw))

  // Everything else needs a signed-in, still-invited person.
  app.use(async (c, next) => {
    const session = await auth().api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'Signed out' }, 401)
    if (!isAllowed(session.user.email)) return c.json({ error: 'Not invited' }, 403)
    c.set('userId', session.user.id)
    await next()
  })

  app.get('/account', async (c) => {
    const session = (await auth().api.getSession({ headers: c.req.raw.headers }))!
    const { name, email, image } = session.user
    c.header('Cache-Control', 'no-store')
    return c.json<AccountInfo>({ name, email, image: image ?? null })
  })

  app.route('/', syncRoutes)
  app.route('/', aiRoutes)
  app.route('/', groupingRoutes)

  app.onError((err, c) => {
    console.error(err)
    return c.json({ error: 'Something went wrong' }, 500)
  })

  return app
}
