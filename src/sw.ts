import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { SHARE_ACTION, SHARE_CACHE, SHARE_ENTRY, SHARED_PARAM } from './lib/share-inbox'

declare const self: ServiceWorkerGlobalScope

// Registered before Workbox's routes so it sees the share-sheet POST first.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const action = new URL(SHARE_ACTION, self.registration.scope)
  if (event.request.method !== 'POST' || url.pathname !== action.pathname) return

  event.respondWith(
    (async () => {
      const form = await event.request.formData()
      const image = form
        .getAll('image')
        .find((value): value is File => value instanceof File && value.type.startsWith('image/'))

      if (image) {
        const cache = await caches.open(SHARE_CACHE)
        await cache.put(
          new URL(SHARE_ENTRY, self.registration.scope).href,
          new Response(image, { headers: { 'Content-Type': image.type } }),
        )
      }
      const target = new URL(self.registration.scope)
      target.searchParams.set(SHARED_PARAM, image ? 'image' : 'none')
      return Response.redirect(target.href, 303)
    })(),
  )
})

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))
