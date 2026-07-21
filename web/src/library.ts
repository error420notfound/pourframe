import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrewRecipe, BrewRecord, Collection } from './brewTypes'
import { defaultRecipes } from './defaultRecipes'
import { buildSchedule, migrateRecipe } from './brew'
import { decodeTrace, type BrewTraceSample } from './trace'

type LibraryStatus = 'loading' | 'ready' | 'cached' | 'error'
interface ApiErrorBody { error?: { code?: string; message?: string } }

const mockMode = import.meta.env.DEV && !import.meta.env.VITE_DEVICE_HOST
const configuredHost = import.meta.env.VITE_DEVICE_HOST as string | undefined
const apiBase = configuredHost ? `http://${configuredHost}` : ''
const databaseName = 'pourframe-ui-v1'
const cacheStore = 'cache'
const outboxStore = 'outbox'
let mockRecipes: Collection<BrewRecipe> = { v: 1, revision: 0, items: [] }
let mockBrews: Collection<BrewRecord> = { v: 1, revision: 0, items: [] }
const mockTraces = new Map<string, Uint8Array>()
interface PendingBrew { id: string; record: BrewRecord; trace?: ArrayBuffer }

export class LibraryApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

export async function retryOnConflict<T>(operation: () => Promise<T>, refresh: () => Promise<void>) {
  try { return await operation() } catch (error) {
    if (!(error instanceof LibraryApiError) || error.status !== 409) throw error
    await refresh()
    return operation()
  }
}

export function parseLegacyRecipes(raw: string | null): BrewRecipe[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is BrewRecipe => Boolean(item && typeof item === 'object' && typeof (item as BrewRecipe).id === 'string')).slice(0, 24).map(migrateRecipe) : []
  } catch { return [] }
}

export function parseLegacyBrews(raw: string | null): BrewRecord[] {
  if (!raw) return []
  try {
    const values = JSON.parse(raw) as Array<{ id?: string; date?: string; elapsed?: number; recipe?: BrewRecipe }>
    if (!Array.isArray(values)) return []
    return values.filter((item) => item?.recipe && typeof item.recipe.id === 'string')
      .sort((left, right) => Date.parse(right.date ?? '') - Date.parse(left.date ?? ''))
      .slice(0, 5).map((item) => {
      const recipe = migrateRecipe(item.recipe!)
      return {
      id: item.id || `legacy-${item.recipe!.id}-${item.date ?? 'unknown'}`,
      completed_at: item.date && !Number.isNaN(Date.parse(item.date)) ? new Date(item.date).toISOString() : new Date().toISOString(),
      elapsed_s: Number.isFinite(item.elapsed) ? Math.max(0, item.elapsed!) : item.recipe!.brewTime,
      recipe,
      schedule: buildSchedule(recipe), baselines: [], transitions: [],
      final: { upper_g: null, lower_g: null, total_g: null, beverage_g: null },
      sensor_summary: { mode: 'timer_only', samples: 0, upper_available_frames: 0, lower_available_frames: 0, partial_frames: 0, confidence_min: null, confidence_mean: null, confidence_final: null, final_state: null, pair_status_counts: { synchronized: 0, retained_peer: 0, unavailable: 0 } },
      trace: null,
    }} )
  } catch { return [] }
}

export function retainNewestBrews(records: BrewRecord[]) {
  return [...records].sort((left, right) => Date.parse(right.completed_at) - Date.parse(left.completed_at)).slice(0, 5)
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(cacheStore)
      request.result.createObjectStore(outboxStore, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function databaseGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDatabase()
  return new Promise<T | undefined>((resolve, reject) => {
    const request = database.transaction(storeName).objectStore(storeName).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

async function databasePut<T>(storeName: string, value: T, key?: IDBValidKey) {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const request = key === undefined
      ? database.transaction(storeName, 'readwrite').objectStore(storeName).put(value)
      : database.transaction(storeName, 'readwrite').objectStore(storeName).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

async function databaseDelete(storeName: string, key: IDBValidKey) {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const request = database.transaction(storeName, 'readwrite').objectStore(storeName).delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

async function databaseAll<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase()
  return new Promise<T[]>((resolve, reject) => {
    const request = database.transaction(storeName).objectStore(storeName).getAll()
    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init)
  if (!response.ok) {
    let body: ApiErrorBody = {}
    try { body = await response.json() as ApiErrorBody } catch { /* use status text */ }
    throw new LibraryApiError(response.status, body.error?.code ?? 'request_failed', body.error?.message ?? response.statusText)
  }
  return response.json() as Promise<T>
}

async function readRecipes() {
  if (mockMode) return mockRecipes
  return requestJson<Collection<BrewRecipe>>('/api/recipes')
}

async function readBrews() {
  if (mockMode) return mockBrews
  return requestJson<Collection<BrewRecord>>('/api/brews?limit=5')
}

async function postRecipe(recipe: BrewRecipe, baseRevision: number) {
  recipe = migrateRecipe(recipe)
  if (mockMode) {
    const found = mockRecipes.items.findIndex((item) => item.id === recipe.id)
    const items = [...mockRecipes.items]
    if (found >= 0) items[found] = recipe; else items.unshift(recipe)
    mockRecipes = { v: 1, revision: mockRecipes.revision + 1, items: items.slice(0, 24) }
    return mockRecipes
  }
  return requestJson<Collection<BrewRecipe>>('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, base_revision: baseRevision, recipe }) })
}

async function postBrew(brew: BrewRecord) {
  if (mockMode) {
    if (!mockBrews.items.some((item) => item.id === brew.id)) mockBrews = { v: 1, revision: mockBrews.revision + 1, items: retainNewestBrews([brew, ...mockBrews.items]) }
    return mockBrews
  }
  return requestJson<Collection<BrewRecord>>('/api/brews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, brew }) })
}

async function putTrace(id: string, trace: ArrayBuffer | Uint8Array) {
  const body = trace instanceof Uint8Array ? trace : new Uint8Array(trace)
  if (mockMode) { mockTraces.set(id, body.slice()); return }
  const response = await fetch(`${apiBase}/api/brew-traces?id=${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: body as BodyInit })
  if (!response.ok) {
    let message = response.statusText
    try { message = ((await response.json()) as ApiErrorBody).error?.message ?? message } catch { /* status text */ }
    throw new Error(message || 'Trace upload failed')
  }
}

export async function loadBrewTrace(id: string): Promise<BrewTraceSample[]> {
  if (mockMode) {
    const bytes = mockTraces.get(id)
    if (!bytes) throw new LibraryApiError(404, 'trace_not_found', 'This brew trace is unavailable.')
    return decodeTrace(bytes)
  }
  const response = await fetch(`${apiBase}/api/brew-traces?id=${encodeURIComponent(id)}`)
  if (!response.ok) throw new LibraryApiError(response.status, 'trace_load_failed', response.status === 404 ? 'This brew trace is unavailable.' : 'The brew trace could not be loaded.')
  return decodeTrace(new Uint8Array(await response.arrayBuffer()))
}

export function legacyDataAvailable() {
  return Boolean(localStorage.getItem('pourover.recipes.v1') || localStorage.getItem('pourover.brewLog.v1')) && localStorage.getItem('pourframe.legacyImported') !== 'true'
}

export function useLibrary() {
  const [recipes, setRecipes] = useState<BrewRecipe[]>(defaultRecipes)
  const [brews, setBrews] = useState<BrewRecord[]>([])
  const [status, setStatus] = useState<LibraryStatus>('loading')
  const [message, setMessage] = useState('Loading shared recipes…')
  const [hasLegacy, setHasLegacy] = useState(legacyDataAvailable)
  const recipeRevision = useRef(0)
  const brewRevision = useRef(0)

  const refresh = useCallback(async () => {
    setStatus('loading')
    try {
      let [recipeCollection, brewCollection] = await Promise.all([readRecipes(), readBrews()])
      recipeCollection = { ...recipeCollection, items: recipeCollection.items.map(migrateRecipe) }
      brewCollection = { ...brewCollection, items: retainNewestBrews(brewCollection.items) }
      if (recipeCollection.items.length === 0) {
        for (const recipe of defaultRecipes) recipeCollection = await postRecipe(recipe, recipeCollection.revision)
      }
      recipeRevision.current = recipeCollection.revision
      brewRevision.current = brewCollection.revision
      setRecipes(recipeCollection.items)
      setBrews(brewCollection.items)
      setStatus('ready'); setMessage('Shared data is stored on PourFrame')
      await Promise.all([databasePut(cacheStore, recipeCollection, 'recipes'), databasePut(cacheStore, brewCollection, 'brews')])
      const pending = await databaseAll<PendingBrew | BrewRecord>(outboxStore)
      for (const item of pending) {
        const record = 'record' in item ? item.record : item
        const trace = 'record' in item ? item.trace : undefined
        if (trace) await putTrace(record.id, trace)
        brewCollection = await postBrew(record)
        await databaseDelete(outboxStore, record.id)
      }
      if (pending.length) { brewRevision.current = brewCollection.revision; setBrews(brewCollection.items) }
    } catch (error) {
      const [cachedRecipes, cachedBrews] = await Promise.all([
        databaseGet<Collection<BrewRecipe>>(cacheStore, 'recipes'), databaseGet<Collection<BrewRecord>>(cacheStore, 'brews'),
      ]).catch(() => [undefined, undefined])
      if (cachedRecipes?.items.length) setRecipes(cachedRecipes.items)
      if (cachedBrews) setBrews(cachedBrews.items)
      setStatus(cachedRecipes ? 'cached' : 'error')
      setMessage(error instanceof Error ? error.message : 'Shared data is unavailable')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const saveRecipe = useCallback(async (recipe: BrewRecipe) => {
    try {
      let collection = await postRecipe(recipe, recipeRevision.current)
      recipeRevision.current = collection.revision
      setRecipes(collection.items)
      await databasePut(cacheStore, collection, 'recipes')
    } catch (error) {
      if (!(error instanceof LibraryApiError) || error.status !== 409) throw error
      const latest = await readRecipes()
      recipeRevision.current = latest.revision
      const collection = await postRecipe(recipe, latest.revision)
      recipeRevision.current = collection.revision
      setRecipes(collection.items)
      await databasePut(cacheStore, collection, 'recipes')
    }
  }, [])

  const deleteRecipe = useCallback(async (id: string) => {
    if (mockMode) {
      mockRecipes = { ...mockRecipes, revision: mockRecipes.revision + 1, items: mockRecipes.items.filter((item) => item.id !== id) }
      recipeRevision.current = mockRecipes.revision; setRecipes(mockRecipes.items); return
    }
    const remove = (revision: number) => requestJson<Collection<BrewRecipe>>(`/api/recipes?id=${encodeURIComponent(id)}&base_revision=${revision}`, { method: 'DELETE' })
    try {
      const collection = await remove(recipeRevision.current)
      recipeRevision.current = collection.revision; setRecipes(collection.items); await databasePut(cacheStore, collection, 'recipes')
    } catch (error) {
      if (!(error instanceof LibraryApiError) || error.status !== 409) throw error
      const latest = await readRecipes(); recipeRevision.current = latest.revision
      const collection = await remove(latest.revision)
      recipeRevision.current = collection.revision; setRecipes(collection.items); await databasePut(cacheStore, collection, 'recipes')
    }
  }, [])

  const saveBrew = useCallback(async (brew: BrewRecord, trace?: Uint8Array) => {
    const pending: PendingBrew = { id: brew.id, record: brew, trace: trace?.buffer.slice(trace.byteOffset, trace.byteOffset + trace.byteLength) as ArrayBuffer | undefined }
    try {
      if (trace) await putTrace(brew.id, trace)
      const collection = await postBrew(brew)
      brewRevision.current = collection.revision; setBrews(collection.items)
      await Promise.all([databasePut(cacheStore, collection, 'brews'), databaseDelete(outboxStore, brew.id)])
    } catch (error) {
      await databasePut(outboxStore, pending)
      throw error
    }
  }, [])

  const clearBrews = useCallback(async () => {
    if (mockMode) { mockBrews = { v: 1, revision: mockBrews.revision + 1, items: [] }; setBrews([]); return }
    const collection = await requestJson<Collection<BrewRecord>>(`/api/brews?confirm=clear&base_revision=${brewRevision.current}`, { method: 'DELETE' })
    brewRevision.current = collection.revision; setBrews([]); await databasePut(cacheStore, collection, 'brews')
  }, [])

  const importLegacy = useCallback(async () => {
    const values = parseLegacyRecipes(localStorage.getItem('pourover.recipes.v1'))
    for (const recipe of values) await saveRecipe(recipe)
    const legacyBrews = parseLegacyBrews(localStorage.getItem('pourover.brewLog.v1'))
    for (const brew of legacyBrews) await saveBrew(brew)
    localStorage.removeItem('pourover.recipes.v1')
    localStorage.removeItem('pourover.brewLog.v1')
    localStorage.setItem('pourframe.legacyImported', 'true')
    setHasLegacy(false)
  }, [saveBrew, saveRecipe])

  return { recipes, brews, status, message, hasLegacy, refresh, saveRecipe, deleteRecipe, saveBrew, clearBrews, importLegacy }
}
