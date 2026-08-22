const PINNED_CDN_PATTERN = /^https:\/\/cdn\.jsdelivr\.net\/gh\/error420notfound\/pourframe@[0-9a-f]{40}\/web\/remote-assets\/v[1-9][0-9]*$/i

export function normalizeRemoteAssetBaseUrl(configured = '') {
  return configured.trim().replace(/\/+$/, '')
}

export function validateRemoteAssetBaseUrl(configured = '', { mode = 'production' } = {}) {
  const baseUrl = normalizeRemoteAssetBaseUrl(configured)
  if (!baseUrl) return ''

  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('VITE_REMOTE_ASSET_BASE_URL must be an absolute URL or empty.')
  }

  const localDevelopment = mode !== 'production' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  if (localDevelopment && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) return baseUrl

  if (!PINNED_CDN_PATTERN.test(baseUrl)) {
    throw new Error('Production remote assets must use the PourFrame jsDelivr path pinned to a full 40-character commit SHA.')
  }
  return baseUrl
}
