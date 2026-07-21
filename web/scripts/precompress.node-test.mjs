import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

import { gzipDeterministic, precompressDirectory, shouldCompress, summarizeAssets } from './precompress.mjs'

test('selects only frontend text formats', () => {
  for (const file of ['index.html', 'app.js', 'style.css', 'data.json', 'logo.svg', 'APP.JS']) {
    assert.equal(shouldCompress(file), true, file)
  }
  for (const file of ['font.woff2', 'image.png', 'photo.jpg', 'photo.jpeg', 'image.webp', 'app.js.gz']) {
    assert.equal(shouldCompress(file), false, file)
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
    await writeFile(path.join(directory, 'index.html'), html)
    await writeFile(path.join(directory, 'assets', 'app.js'), js)
    await writeFile(path.join(directory, 'assets', 'font.woff2'), font)

    const assets = await precompressDirectory(directory)
    assert.deepEqual(await readdir(directory), ['assets', 'index.html.gz'])
    assert.deepEqual((await readdir(path.join(directory, 'assets'))).sort(), ['app.js.gz', 'font.woff2'])
    assert.deepEqual(gunzipSync(await readFile(path.join(directory, 'index.html.gz'))), html)
    assert.deepEqual(gunzipSync(await readFile(path.join(directory, 'assets', 'app.js.gz'))), js)
    assert.deepEqual(await readFile(path.join(directory, 'assets', 'font.woff2')), font)

    const totals = summarizeAssets(assets)
    assert.equal(totals.rawBytes, html.length + js.length + font.length)
    assert.ok(totals.storedBytes < totals.rawBytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
