import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/sw.js')
const serviceWorkerSource = (await readFile(scriptPath, 'utf8')).replaceAll('__POURFRAME_CACHE_VERSION__', 'test-version')

function runtime({ fetchImpl = async () => new Response('network'), matches = new Map(), cacheNames = [] } = {}) {
  const listeners = new Map()
  const deleted = []
  const added = []
  const stored = []
  let skipped = false
  let claimed = false
  const cache = {
    addAll: async (urls) => { added.push(...urls) },
    put: async (request, response) => { stored.push({ request, response }) },
  }
  const caches = {
    open: async () => cache,
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
  return { listeners, deleted, added, stored, state: () => ({ skipped, claimed }) }
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
  assert.deepEqual(value.added, [
    './', './index.html', './manifest.webmanifest', './favicon.ico', './favicon-16x16.png',
    './favicon-32x32.png', './apple-touch-icon.png', './assets/pourover-icon-master.png',
  ])
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
