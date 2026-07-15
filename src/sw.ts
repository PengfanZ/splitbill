/// <reference lib="webworker" />

import { createCacheName, isTallyCache, resolvePrecacheUrls, type PrecacheEntry } from './pwa/cacheManifest'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: PrecacheEntry[]
}

const precacheManifest = self.__WB_MANIFEST
const cacheName = createCacheName(precacheManifest)
const precacheUrls = resolvePrecacheUrls(precacheManifest, self.location.href)
const appShellUrl = new URL('index.html', self.location.href).href

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    await cache.addAll(precacheUrls)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    const staleCaches = cacheNames.filter(name => isTallyCache(name) && name !== cacheName)
    await Promise.all(staleCaches.map(name => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const requestUrl = new URL(request.url)
  if (requestUrl.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(caches.match(appShellUrl, { ignoreVary: true }).then(cached => cached ?? fetch(request)))
    return
  }

  event.respondWith(caches.match(request, { ignoreVary: true }).then(cached => cached ?? fetch(request)))
})
