import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeRemoteAssetBaseUrl, validateRemoteAssetBaseUrl } from './remote-asset-config.mjs'

const pinned = `https://cdn.jsdelivr.net/gh/error420notfound/pourframe@${'a'.repeat(40)}/web/remote-assets/v1`

test('normalizes an empty or trailing-slash remote base', () => {
  assert.equal(validateRemoteAssetBaseUrl(), '')
  assert.equal(normalizeRemoteAssetBaseUrl(`${pinned}/`), pinned)
  assert.equal(validateRemoteAssetBaseUrl(`${pinned}/`), pinned)
})

test('rejects mutable and unpinned production URLs', () => {
  for (const value of [
    'https://cdn.jsdelivr.net/gh/error420notfound/pourframe@main/web/remote-assets/v1',
    'https://cdn.jsdelivr.net/gh/error420notfound/pourframe@assets-v1/web/remote-assets/v1',
    'https://example.com/assets/v1',
    '/assets/v1',
  ]) assert.throws(() => validateRemoteAssetBaseUrl(value), /absolute URL|full 40-character commit SHA/)
})

test('allows localhost only for development', () => {
  assert.equal(validateRemoteAssetBaseUrl('http://127.0.0.1:8081/v1/', { mode: 'development' }), 'http://127.0.0.1:8081/v1')
  assert.throws(() => validateRemoteAssetBaseUrl('http://127.0.0.1:8081/v1'), /full 40-character commit SHA/)
})
