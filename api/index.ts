// The Vercel Function behind every /api/* request (see the rewrite in vercel.json).
import { createApp } from '../server/app.js'

const app = createApp()

export default {
  fetch: (request: Request) => app.fetch(request),
}
