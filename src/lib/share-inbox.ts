// Shared between the page and the service worker: the worker parks an image that was shared
// to the app (Android share sheet) in this cache, then the page picks it up after the redirect.
export const SHARE_CACHE = 'share-inbox'
export const SHARE_ENTRY = 'shared-image'
export const SHARE_ACTION = 'share-target'
export const SHARED_PARAM = 'shared'
