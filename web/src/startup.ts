import { catalogClient, catalogRecentlyUsed } from './catalog'
import { warmRemoteFonts } from './remoteAssets'

export type StartupPhase = 'idle' | 'restoring' | 'ready' | 'unavailable' | 'running' | 'complete' | 'offline' | 'conflict' | 'failed' | 'skipped'

export interface StartupState {
  shell: 'loading' | 'ready'
  localData: 'restoring' | 'ready' | 'unavailable'
  espSync: 'idle' | 'running' | 'complete' | 'offline' | 'conflict' | 'failed'
  remoteWarm: 'skipped' | 'running' | 'complete' | 'failed'
}

const initialState: StartupState = { shell: 'loading', localData: 'restoring', espSync: 'idle', remoteWarm: 'skipped' }
let state = initialState
const listeners = new Set<() => void>()
const inFlight = new Map<string, Promise<unknown>>()
const metrics = new Map<string, number>()
const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
let splashTimer: number | undefined

function debugEnabled() {
  if (import.meta.env.DEV) return true
  try { return localStorage.getItem('pourframe.debug.cache') === 'true' } catch { return false }
}

export function cacheDebug(event: string, detail: Record<string, unknown> = {}) {
  metrics.set(event, (metrics.get(event) ?? 0) + 1)
  if (debugEnabled()) console.debug(`[PourFrame cache] ${event}`, detail)
}

export function startupDiagnostics() {
  return { state, startedAt, metrics: Object.fromEntries(metrics) }
}

export function getStartupState() { return state }
export function subscribeStartup(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }

export function setStartupState<K extends keyof StartupState>(key: K, value: StartupState[K]) {
  if (state[key] === value) return
  state = { ...state, [key]: value }
  cacheDebug(`state:${key}:${value}`)
  listeners.forEach((listener) => listener())
}

export function deduplicate<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined
  if (pending) { cacheDebug('request:deduplicated', { key }); return pending }
  const request = operation().finally(() => inFlight.delete(key))
  inFlight.set(key, request)
  return request
}

export function sharedFetch(input: RequestInfo | URL, init?: RequestInit, key = `${init?.method ?? 'GET'}:${String(input)}`) {
  return deduplicate(key, () => fetch(input, init)).then((response) => response.clone())
}

function removeSplash() {
  if (splashTimer !== undefined) window.clearTimeout(splashTimer)
  const splash = document.getElementById('app-splash')
  if (!splash) return
  splash.classList.add('app-splash--hidden')
  window.setTimeout(() => splash.remove(), 220)
}

export function beginStartup() {
  if (typeof window === 'undefined') return
  if (debugEnabled()) (window as Window & { __POURFRAME_CACHE_DIAGNOSTICS__?: typeof startupDiagnostics }).__POURFRAME_CACHE_DIAGNOSTICS__ = startupDiagnostics
  splashTimer ??= window.setTimeout(() => {
    cacheDebug('splash:watchdog')
    removeSplash()
  }, 750)
}

export function markShellReady() {
  setStartupState('shell', 'ready')
  try { performance.mark('pourframe-shell-ready') } catch { /* performance marks are optional */ }
  cacheDebug('shell:interactive', { elapsedMs: (typeof performance === 'undefined' ? Date.now() : performance.now()) - startedAt })
  removeSplash()
}

export async function espHealthProbe(timeoutMs = 1_000): Promise<boolean> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await sharedFetch('/api/health', { signal: controller.signal, cache: 'no-store' }, 'GET:/api/health')
    return response.ok
  } catch { return false } finally { window.clearTimeout(timeout) }
}

export function canUseControlledCaches() {
  return Boolean(typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window)
}

export async function storageHasRoom() {
  try {
    const estimate = await navigator.storage?.estimate?.()
    return !estimate?.quota || !estimate.usage || estimate.usage / estimate.quota < .8
  } catch { return true }
}

export async function startOptionalWarming() {
  if (typeof window === 'undefined') return
  if (state.localData === 'restoring') await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => { unsubscribe(); resolve() }, 2_000)
    const unsubscribe = subscribeStartup(() => {
      if (state.localData === 'restoring') return
      window.clearTimeout(timeout); unsubscribe(); resolve()
    })
  })
  const disabled = (() => { try { return localStorage.getItem('pourframe.cache-warming.disabled') === 'true' } catch { return false } })()
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (disabled || navigator.onLine === false || connection?.saveData || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g' || !await storageHasRoom()) {
    setStartupState('remoteWarm', 'skipped'); return
  }
  setStartupState('remoteWarm', 'running')
  cacheDebug('capability:controlled-cache', { available: canUseControlledCaches(), secureContext: window.isSecureContext })
  try {
    const tasks: Promise<unknown>[] = [warmRemoteFonts()]
    if (catalogRecentlyUsed()) tasks.push(catalogClient.roasteries(), catalogClient.recipes())
    const results = await Promise.allSettled(tasks)
    setStartupState('remoteWarm', results.some((result) => result.status === 'fulfilled' && result.value !== false) ? 'complete' : 'failed')
  } catch { setStartupState('remoteWarm', 'failed') }
}
