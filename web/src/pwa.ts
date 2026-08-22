import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let installPrompt: BeforeInstallPromptEvent | null = null
let listenersInstalled = false
const promptListeners = new Set<() => void>()

function notifyPromptListeners() {
  promptListeners.forEach((listener) => listener())
}

function ensureInstallListeners() {
  if (listenersInstalled || typeof window === 'undefined') return
  listenersInstalled = true
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt = event as BeforeInstallPromptEvent
    notifyPromptListeners()
  })
  window.addEventListener('appinstalled', () => {
    installPrompt = null
    notifyPromptListeners()
  })
}

export function registerPourFrameServiceWorker() {
  if (!import.meta.env.PROD || typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    void (async () => {
      if (!('caches' in window)) return
      const probe = 'pourframe-capability-probe'
      try { await caches.open(probe); await caches.delete(probe) } catch { return }
      await navigator.serviceWorker.register('./sw.js', { scope: './' })
    })().catch(() => { /* The app remains fully usable when registration is unavailable. */ })
  }, { once: true })
}

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(() => Boolean(installPrompt))

  useEffect(() => {
    ensureInstallListeners()
    const sync = () => setCanInstall(Boolean(installPrompt))
    promptListeners.add(sync)
    sync()
    return () => { promptListeners.delete(sync) }
  }, [])

  const install = useCallback(async () => {
    const prompt = installPrompt
    if (!prompt) return
    installPrompt = null
    notifyPromptListeners()
    await prompt.prompt()
    await prompt.userChoice.catch(() => undefined)
  }, [])

  return { canInstall, install }
}
