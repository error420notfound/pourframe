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
