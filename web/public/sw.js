const CACHE_PREFIX = 'pourframe-shell-'
const CACHE_NAME = `${CACHE_PREFIX}__POURFRAME_CACHE_VERSION__`
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.ico',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './apple-touch-icon.png',
  './assets/pourover-icon-master.png',
]

function isApiRequest(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/')
}

function isStaticRequest(request, url) {
  if (request.method !== 'GET' || url.origin !== self.location.origin || isApiRequest(url)) return false
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return request.destination === 'script' || request.destination === 'style' || request.destination === 'image' ||
    request.destination === 'font' || request.destination === 'manifest'
}

async function cacheResponse(request, response) {
  if (response && response.ok && response.type !== 'opaque') {
    const cache = await caches.open(CACHE_NAME)
    await cache.put(request, response.clone())
  }
  return response
}

async function navigationResponse(request) {
  try {
    return await cacheResponse(request, await fetch(request))
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match('./index.html')) ||
      (await caches.match('./')) ||
      Response.error()
  }
}

async function staticResponse(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  return cacheResponse(request, await fetch(request))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || isApiRequest(url) || url.protocol === 'ws:' || url.protocol === 'wss:') return
  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
    return
  }
  if (isStaticRequest(request, url)) event.respondWith(staticResponse(request))
})
