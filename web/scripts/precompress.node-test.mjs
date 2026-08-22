import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

import { gzipDeterministic, precompressDirectory, shouldCompress, stampServiceWorker, summarizeAssets } from './precompress.mjs'

test('selects only frontend text formats', () => {
  for (const file of ['index.html', 'app.js', 'style.css', 'data.json', 'logo.svg', 'manifest.webmanifest', 'APP.JS']) {
    assert.equal(shouldCompress(file), true, file)
  }
  for (const file of ['font.woff2', 'image.png', 'photo.jpg', 'photo.jpeg', 'image.webp', 'app.js.gz']) {
    assert.equal(shouldCompress(file), false, file)
  }
})

test('stamps the service-worker cache from generated frontend contents', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pourframe-sw-version-'))
  try {
    const workerTemplate = "const CACHE='__POURFRAME_CACHE_VERSION__'\nconst REMOTE=__POURFRAME_REMOTE_ASSET_BASE_URL__\nconst REMOTE_CACHE='__POURFRAME_REMOTE_CACHE_VERSION__'\nconst SHELL=__POURFRAME_SHELL_URLS__\n"
    await writeFile(path.join(directory, 'sw.js'), workerTemplate)
    await writeFile(path.join(directory, 'index.html'), '<main>one</main>')
    const pinned = `https://cdn.jsdelivr.net/gh/error420notfound/pourframe@${'a'.repeat(40)}/web/remote-assets/v1`
    const first = await stampServiceWorker(directory, pinned)
    assert.match(first, /^[a-f0-9]{16}$/)
    const stamped = await readFile(path.join(directory, 'sw.js'), 'utf8')
    assert.match(stamped, new RegExp(first))
    assert.match(stamped, /\.\/index\.html/)
    assert.match(stamped, new RegExp(pinned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    await writeFile(path.join(directory, 'sw.js'), workerTemplate)
    await writeFile(path.join(directory, 'index.html'), '<main>two</main>')
    const second = await stampServiceWorker(directory, pinned)
    assert.notEqual(second, first)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('gzip output is deterministic and round trips', () => {
  const input = Buffer.from('PourFrame deterministic gzip\n'.repeat(50))
  const first = gzipDeterministic(input)
  const second = gzipDeterministic(input)
  assert.deepEqual(first, second)
  assert.deepEqual(gunzipSync(first), input)
  assert.equal(first[4], 0)
  assert.equal(first[5], 0)
  assert.equal(first[6], 0)
  assert.equal(first[7], 0)
})

test('recursively replaces eligible files and preserves compressed formats', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pourframe-gzip-'))
  try {
    await mkdir(path.join(directory, 'assets'))
    const html = Buffer.from('<!doctype html><main>PourFrame</main>')
    const js = Buffer.from('console.log("PourFrame")'.repeat(20))
    const font = Buffer.from([0x77, 0x4f, 0x46, 0x32])
    const audio = Buffer.from([0x52, 0x49, 0x46, 0x46])
    const manifest = Buffer.from('{"name":"PourFrame"}')
    const serviceWorker = Buffer.from("const CACHE='__POURFRAME_CACHE_VERSION__'\nconst REMOTE=__POURFRAME_REMOTE_ASSET_BASE_URL__\nconst REMOTE_CACHE='__POURFRAME_REMOTE_CACHE_VERSION__'\nconst SHELL=__POURFRAME_SHELL_URLS__")
    await writeFile(path.join(directory, 'index.html'), html)
    await writeFile(path.join(directory, 'assets', 'app.js'), js)
    await writeFile(path.join(directory, 'assets', 'font.woff2'), font)
    await writeFile(path.join(directory, 'assets', 'tick-test.wav'), audio)
    await writeFile(path.join(directory, 'manifest.webmanifest'), manifest)
    await writeFile(path.join(directory, 'sw.js'), serviceWorker)

    const assets = await precompressDirectory(directory)
    assert.deepEqual(await readdir(directory), ['assets', 'index.html.gz', 'manifest.webmanifest.gz', 'sw.js.gz'])
    assert.deepEqual((await readdir(path.join(directory, 'assets'))).sort(), ['app.js.gz', 'font.woff2', 'tick-test.wav'])
    assert.deepEqual(gunzipSync(await readFile(path.join(directory, 'index.html.gz'))), html)
    assert.deepEqual(gunzipSync(await readFile(path.join(directory, 'assets', 'app.js.gz'))), js)
    assert.deepEqual(await readFile(path.join(directory, 'assets', 'font.woff2')), font)
    assert.deepEqual(gunzipSync(await readFile(path.join(directory, 'manifest.webmanifest.gz'))), manifest)
    const stampedWorker = gunzipSync(await readFile(path.join(directory, 'sw.js.gz'))).toString()
    assert.doesNotMatch(stampedWorker, /__POURFRAME_CACHE_VERSION__/)
    assert.doesNotMatch(stampedWorker, /__POURFRAME_REMOTE_ASSET_BASE_URL__/)
    assert.doesNotMatch(stampedWorker, /__POURFRAME_REMOTE_CACHE_VERSION__/)
    assert.doesNotMatch(stampedWorker, /__POURFRAME_SHELL_URLS__/)
    assert.doesNotMatch(stampedWorker, /tick-test\.wav/)

    const totals = summarizeAssets(assets)
    assert.ok(totals.rawBytes >= html.length + js.length + font.length + manifest.length)
    assert.ok(totals.storedBytes < totals.rawBytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
