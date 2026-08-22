import type { ImgHTMLAttributes, SyntheticEvent } from 'react'

export const remoteAssetBaseUrl = (import.meta.env.VITE_REMOTE_ASSET_BASE_URL ?? '').trim().replace(/\/+$/, '')

export function remoteAssetUrl(relativePath: string, baseUrl = remoteAssetBaseUrl): string | null {
  const normalizedPath = relativePath.replace(/^\/+/, '')
  if (!baseUrl || !normalizedPath || normalizedPath.split('/').includes('..')) return null
  return `${baseUrl}/${normalizedPath}`
}

export function localAssetUrl(relativePath: string): string {
  return `${import.meta.env.BASE_URL}${relativePath.replace(/^\/+/, '')}`
}

export function installRemoteFonts(documentValue: Document | null = typeof document === 'undefined' ? null : document): HTMLLinkElement | null {
  const href = remoteAssetUrl('fonts/oswald.css')
  if (!documentValue || !href) return null
  const existing = documentValue.querySelector<HTMLLinkElement>('link[data-pourframe-remote-fonts]')
  if (existing) return existing

  const link = documentValue.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.crossOrigin = 'anonymous'
  link.dataset.pourframeRemoteFonts = 'true'
  documentValue.head.append(link)
  return link
}

export async function warmRemoteFonts() {
  const cssUrl = remoteAssetUrl('fonts/oswald.css')
  if (!cssUrl) return false
  try {
    const response = await fetch(cssUrl, { mode: 'cors' })
    if (!response.ok) return false
    await document.fonts?.load?.('400 1rem "Oswald Variable"')
    return true
  } catch { return false }
}

interface RemoteAssetImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  fallbackSrc: string
  remotePath: string
}

export function RemoteAssetImage({ fallbackSrc, remotePath, onError, ...props }: RemoteAssetImageProps) {
  const remoteSrc = remoteAssetUrl(remotePath)
  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    if (image.getAttribute('src') !== fallbackSrc) {
      image.removeAttribute('crossorigin')
      image.src = fallbackSrc
    }
    onError?.(event)
  }

  return <img
    {...props}
    crossOrigin={remoteSrc ? 'anonymous' : undefined}
    onError={remoteSrc ? handleError : onError}
    src={remoteSrc ?? fallbackSrc}
  />
}
