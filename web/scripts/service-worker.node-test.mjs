import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/sw.js')
const remoteBase = `https://cdn.jsdelivr.net/gh/error420notfound/pourframe@${'a'.repeat(40)}/web/remote-assets/v1`
const shellUrls = ['./', './index.html', './assets/app.js', './assets/onboarding-fallback.svg', './assets/pwa-192.png', './assets/pwa-512.png']
const serviceWorkerSource = (await readFile(scriptPath, 'utf8'))
  .replaceAll('__POURFRAME_CACHE_VERSION__', 'test-version')
  .replaceAll('__POURFRAME_REMOTE_ASSET_BASE_URL__', JSON.stringify(remoteBase))
  .replaceAll('__POURFRAME_REMOTE_CACHE_VERSION__', 'test-remote')
  .replaceAll('__POURFRAME_SHELL_URLS__', JSON.stringify(shellUrls))

function runtime({ fetchImpl = async () => new Response('network'), matches = new Map(), cacheNames = [], cacheEntries = [] } = {}) {
  const listeners = new Map()
  const deleted = []
  const added = []
  const stored = []
  const opened = []
  const evicted = []
  let skipped = false
  let claimed = false
  const cache = {
    addAll: async (urls) => { added.push(...urls) },
    put: async (request, response) => { stored.push({ request, response }) },
    keys: async () => cacheEntries,
    match: async (request) => matches.get(typeof request === 'string' ? request : request.url),
    delete: async (request) => { evicted.push(request); return true },
  }
  const caches = {
    open: async (name) => { opened.push(name); return cache },
    keys: async () => cacheNames,
    delete: async (name) => { deleted.push(name); return true },
    match: async (request) => matches.get(typeof request === 'string' ? request : request.url),
  }
  const self = {
    location: { origin: 'http://localhost' },
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: async () => { skipped = true },
    clients: { claim: async () => { claimed = true } },
  }
  vm.runInNewContext(serviceWorkerSource, { self, caches, fetch: fetchImpl, URL, Response, Promise })
  return { listeners, deleted, added, opened, stored, evicted, state: () => ({ skipped, claimed }) }
}

async function dispatchExtendable(listener) {
  let work = Promise.resolve()
  listener({ waitUntil: (promise) => { work = promise } })
  await work
}

async function dispatchFetch(listener, request) {
  let responsePromise = null
  listener({ request, respondWith: (promise) => { responsePromise = promise } })
  return responsePromise ? responsePromise : null
}

test('installs the local shell and removes older PourFrame caches on activation', async () => {
  const value = runtime({ cacheNames: ['pourframe-shell-old', 'pourframe-shell-test-version', 'unrelated'] })
  await dispatchExtendable(value.listeners.get('install'))
  assert.deepEqual(value.added, shellUrls)
  assert.equal(value.added.some((url) => url.startsWith('https://')), false)
  assert.equal(value.state().skipped, true)

  await dispatchExtendable(value.listeners.get('activate'))
  assert.deepEqual(value.deleted, ['pourframe-shell-old'])
  assert.equal(value.state().claimed, true)
})

test('bypasses APIs, mutating requests, and websocket traffic', async () => {
  const value = runtime()
  const listener = value.listeners.get('fetch')
  assert.equal(await dispatchFetch(listener, { method: 'GET', mode: 'cors', destination: '', url: 'http://localhost/api/recipes' }), null)
  assert.equal(await dispatchFetch(listener, { method: 'POST', mode: 'cors', destination: '', url: 'http://localhost/assets/app.js' }), null)
  assert.equal(await dispatchFetch(listener, { method: 'GET', mode: 'cors', destination: '', url: 'ws://localhost/ws' }), null)
})

test('uses a cached shell when offline navigation fails', async () => {
  const cached = new Response('<main>cached PourFrame</main>')
  const value = runtime({
    fetchImpl: async () => { throw new Error('offline') },
    matches: new Map([['./index.html', cached]]),
  })
  const response = await dispatchFetch(value.listeners.get('fetch'), {
    method: 'GET', mode: 'navigate', destination: 'document', url: 'http://localhost/#history',
  })
  assert.equal(await response.text(), '<main>cached PourFrame</main>')
})

test('serves cached static assets before going to the network', async () => {
  let fetches = 0
  const request = { method: 'GET', mode: 'cors', destination: 'script', url: 'http://localhost/assets/app.js' }
  const value = runtime({
    fetchImpl: async () => { fetches += 1; return new Response('network') },
    matches: new Map([[request.url, new Response('cached script')]]),
  })
  const response = await dispatchFetch(value.listeners.get('fetch'), request)
  assert.equal(await response.text(), 'cached script')
  assert.equal(fetches, 0)
})

test('serves cached remote assets before going to the network', async () => {
  let fetches = 0
  const request = { method: 'GET', mode: 'cors', destination: 'image', url: `${remoteBase}/images/onboarding/meet-pourframe.jpg` }
  const value = runtime({
    fetchImpl: async () => { fetches += 1; return new Response('network') },
    matches: new Map([[request.url, new Response('cached remote image')]]),
  })

  const response = await dispatchFetch(value.listeners.get('fetch'), request)
  assert.equal(await response.text(), 'cached remote image')
  assert.equal(fetches, 0)
})

test('caches successful remote CORS assets without adding them to the shell', async () => {
  const request = { method: 'GET', mode: 'cors', destination: 'font', url: `${remoteBase}/fonts/files/oswald-latin-wght-normal.woff2` }
  const value = runtime({ fetchImpl: async () => new Response('font') })

  const response = await dispatchFetch(value.listeners.get('fetch'), request)
  assert.equal(await response.text(), 'font')
  assert.equal(value.opened.at(-1), 'pourframe-remote-assets-test-remote')
  assert.equal(value.stored.length, 1)
})

test('bounds the separately versioned remote runtime cache', async () => {
  const cacheEntries = Array.from({ length: 25 }, (_, index) => ({ url: `${remoteBase}/images/${index}.png` }))
  const matches = new Map(cacheEntries.map((request) => [request.url, new Response('x', { headers: { 'content-length': '1' } })]))
  const request = { method: 'GET', mode: 'cors', destination: 'image', url: `${remoteBase}/images/new.png` }
  const value = runtime({ cacheEntries, matches, fetchImpl: async () => new Response('new') })
  await dispatchFetch(value.listeners.get('fetch'), request)
  assert.equal(value.evicted.length, 1)
  assert.equal(value.evicted[0], cacheEntries[0])
})

test('lets remote failures reject so the page can use its local fallback', async () => {
  const request = { method: 'GET', mode: 'cors', destination: 'image', url: `${remoteBase}/images/onboarding/two-scales.jpg` }
  const value = runtime({ fetchImpl: async () => { throw new Error('offline') } })

  await assert.rejects(dispatchFetch(value.listeners.get('fetch'), request), /offline/)
})

test('does not intercept unrelated cross-origin images or catalog traffic', async () => {
  const value = runtime()
  const listener = value.listeners.get('fetch')
  assert.equal(await dispatchFetch(listener, { method: 'GET', mode: 'cors', destination: 'image', url: 'https://catalog.example/coffee.jpg' }), null)
  assert.equal(await dispatchFetch(listener, { method: 'GET', mode: 'cors', destination: 'style', url: 'https://cdn.example/styles.css' }), null)
})
