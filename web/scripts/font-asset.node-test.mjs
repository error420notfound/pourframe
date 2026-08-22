import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(scriptDirectory, '..')
const cssPath = resolve(webDirectory, 'remote-assets/v1/fonts/oswald.css')
const manifestPath = resolve(webDirectory, 'remote-assets/v1/manifest.json')

const css = await readFile(cssPath, 'utf8')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const cssAsset = manifest.assets.find((asset) => asset.path === 'fonts/oswald.css')
const fontAssets = manifest.assets.filter((asset) => asset.path.startsWith('fonts/files/'))

test('Oswald local font CSS uses the expected family, weights, ranges, and relative files', () => {
  assert.equal((css.match(/font-family: 'Oswald Variable'/g) ?? []).length, 5)
  assert.equal((css.match(/font-weight: 200 700/g) ?? []).length, 5)
  assert.equal((css.match(/format\('woff2-variations'\)/g) ?? []).length, 5)
  assert.equal((css.match(/unicode-range:/g) ?? []).length, 5)
  assert.doesNotMatch(css, /U\+0000|U\+\?\?/)

  for (const asset of fontAssets) {
    const relativePath = asset.path.replace(/^fonts\//, '')
    assert.match(css, new RegExp(`url\\(\\./${relativePath.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\)`))
  }
})

test('all Oswald WOFF2 files match the published manifest', async () => {
  assert.equal(fontAssets.length, 5)
  for (const asset of fontAssets) {
    const file = await readFile(resolve(webDirectory, 'remote-assets/v1', asset.path))
    assert.equal(file.byteLength, asset.bytes, asset.path)
    assert.equal(createHash('sha256').update(file).digest('hex'), asset.sha256, asset.path)
  }
})

test('the Oswald stylesheet matches the published manifest', () => {
  assert.equal(cssAsset.bytes, Buffer.byteLength(css))
  assert.equal(createHash('sha256').update(css).digest('hex'), cssAsset.sha256)
})

test('the local font source does not depend on a remote URL', () => {
  assert.doesNotMatch(css, /https?:\/\//i)
})
