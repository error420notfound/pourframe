// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.resetModules()
  vi.unstubAllEnvs()
  document.head.querySelectorAll('[data-pourframe-remote-fonts]').forEach((element) => element.remove())
})

describe('remote assets', () => {
  it('uses local assets without issuing remote requests when the base is empty', async () => {
    vi.stubEnv('VITE_REMOTE_ASSET_BASE_URL', '')
    const { RemoteAssetImage, installRemoteFonts, remoteAssetUrl } = await import('./remoteAssets')
    const { getByRole } = render(<RemoteAssetImage alt="Introduction" fallbackSrc="./fallback.svg" remotePath="images/onboarding/meet-pourframe.jpg" />)

    expect(remoteAssetUrl('images/onboarding/meet-pourframe.jpg')).toBeNull()
    expect(getByRole('img').getAttribute('src')).toBe('./fallback.svg')
    expect(installRemoteFonts()).toBeNull()
  })

  it('loads configured assets and switches once to the local fallback on error', async () => {
    vi.stubEnv('VITE_REMOTE_ASSET_BASE_URL', 'https://assets.example/v1/')
    const { RemoteAssetImage } = await import('./remoteAssets')
    const { getByRole } = render(<RemoteAssetImage alt="Introduction" fallbackSrc="./fallback.svg" remotePath="images/onboarding/meet-pourframe.jpg" />)
    const image = getByRole('img')

    expect(image.getAttribute('src')).toBe('https://assets.example/v1/images/onboarding/meet-pourframe.jpg')
    expect(image.getAttribute('crossorigin')).toBe('anonymous')
    fireEvent.error(image)
    expect(image.getAttribute('src')).toBe('./fallback.svg')
    expect(image.hasAttribute('crossorigin')).toBe(false)
    fireEvent.error(image)
    expect(image.getAttribute('src')).toBe('./fallback.svg')
  })

  it('installs the remote font stylesheet only once', async () => {
    vi.stubEnv('VITE_REMOTE_ASSET_BASE_URL', 'https://assets.example/v1')
    const { installRemoteFonts } = await import('./remoteAssets')

    const first = installRemoteFonts()
    expect(first?.href).toBe('https://assets.example/v1/fonts/oswald.css')
    expect(first?.crossOrigin).toBe('anonymous')
    expect(installRemoteFonts()).toBe(first)
  })
})
