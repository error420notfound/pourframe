import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrewRecipe, BrewRecord, CoffeeBag, Collection } from './brewTypes'
import { defaultRecipes } from './defaultRecipes'
import { defaultCoffeeBags } from './defaultCoffeeBags'
import { buildSchedule, migrateRecipe, validateRecipe } from './brew'
import { normalizeCoffeeBag, validateCoffeeBag } from './coffeeBag'
import { decodeTrace, encodeTrace, type BrewTraceSample } from './trace'
import { applyMutationProjection, commitCollectionAndDeleteOutbox, deleteOutbox, mutationDisposition, putCachedCollection, putOutbox, putTraceCache, readCachedCollections, readOutbox, readTraceCache, type BrewOutboxEntry, type MutationOutboxEntry, type MutableCollection } from './libraryStorage'
import { cacheDebug, espHealthProbe, setStartupState, sharedFetch } from './startup'

type LibraryStatus = 'loading' | 'ready' | 'cached' | 'error'
interface ApiErrorBody { error?: { code?: string; message?: string } }

const mockMode = import.meta.env.DEV && !import.meta.env.VITE_DEVICE_HOST
const mockScenario = mockMode && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mock') ?? 'healthy' : 'device'
const configuredHost = import.meta.env.VITE_DEVICE_HOST as string | undefined
const apiBase = configuredHost ? `http://${configuredHost}` : ''
let mockRecipes: Collection<BrewRecipe> = { v: 1, revision: 0, items: [] }
let mockBrews: Collection<BrewRecord> = { v: 1, revision: 0, items: [] }
let mockCoffeeBags: Collection<CoffeeBag> = { v: 1, revision: 0, items: [] }
const mockTraces = new Map<string, Uint8Array>()
interface CompletionResponse {
  v: 1
  brews: Collection<BrewRecord>
  coffee_bags: Collection<CoffeeBag>
  inventory_warning?: string
}

function seedMockHistoryData() {
  const now = Date.now()
  const recipes = [defaultRecipes[2], defaultRecipes[1], defaultRecipes[0], defaultRecipes[2]]
  const names = ['Kalita comfort', 'Light roast clarity', 'Balanced V60', 'Weekend pulse brew']

  const records = recipes.map((recipe, index) => {
    const elapsedS = recipe.brewTime - index * 5
    const schedule = buildSchedule(recipe)
    const transitions = schedule.filter((step) => step.kind === 'pour').map((step, transitionIndex) => ({
      transition_id: `mock-history-transition-${index}-${transitionIndex}`,
      step_id: step.id,
      scheduled_elapsed_ms: Math.round(step.start * 1000),
      actual_elapsed_ms: Math.round((step.start + (transitionIndex % 2 === 0 ? 1.5 : -1)) * 1000),
      actual_timestamp: new Date(now - (index + 1) * 86_400_000 + step.start * 1000).toISOString(),
      outcome: 'automatic' as const,
      cue: 'completed' as const,
      reduced_confidence: false,
    }))
    const sampleCount = Math.round(elapsedS * 2) + 1
    const samples: BrewTraceSample[] = Array.from({ length: sampleCount }, (_, sampleIndex) => {
      const elapsedMs = Math.round(sampleIndex * 500)
      const seconds = elapsedMs / 1000
      const progress = Math.min(1, seconds / elapsedS)
      const steppedProgress = Math.min(1, Math.floor(seconds / Math.max(1, elapsedS / (schedule.length - 1))) / (schedule.length - 1))
      const total = recipe.water * (0.92 * progress + 0.08 * steppedProgress)
      const upper = Math.max(0, recipe.coffee * (0.72 - progress * 0.62) + Math.sin(seconds / 8 + index) * 1.8)
      const lower = total - upper
      return {
        elapsedMs,
        upper,
        lower,
        total,
        relativeUpper: upper - recipe.coffee,
        relativeLower: lower,
        stepWaterAdded: total,
        pourRate: seconds > 0 && seconds < elapsedS ? Math.max(0, (total - recipe.water * (0.92 * Math.max(0, progress - 0.02))) * 2) : 0,
        confidence: 0.92 - (sampleIndex % 9 === 0 ? 0.04 : 0),
        flags: 63,
        stepIndex: Math.min(schedule.length - 1, Math.floor(progress * (schedule.length - 1))),
      }
    })
    const encoded = encodeTrace(samples)
    const completedAt = new Date(now - (index + 1) * 86_400_000 - index * 3_600_000).toISOString()
    const coffeeBag = defaultCoffeeBags[index % defaultCoffeeBags.length]
    const brew: BrewRecord = {
      id: `mock-history-${index + 1}`,
      completed_at: completedAt,
      elapsed_s: elapsedS,
      recipe: { ...recipe, name: names[index] },
      schedule,
      baselines: [],
      transitions,
      final: { upper_g: 2.5 + index, lower_g: Math.round(recipe.water * (0.97 - index * 0.015) * 10) / 10, total_g: recipe.water, beverage_g: Math.round(recipe.water * (0.97 - index * 0.015) * 10) / 10 },
      sensor_summary: { mode: 'device', samples: sampleCount, upper_available_frames: sampleCount, lower_available_frames: sampleCount, partial_frames: 0, confidence_min: 0.88, confidence_mean: 0.92, confidence_final: 0.94, final_state: 'DRAWDOWN', pair_status_counts: { synchronized: sampleCount, retained_peer: 0, unavailable: 0 } },
      trace: encoded.metadata,
      coffee_bag: (() => { const { remainingWeightG: _remaining, createdAt: _created, updatedAt: _updated, ...snapshot } = coffeeBag; return snapshot })(),
      coffee_used_g: recipe.coffee,
    }
    mockTraces.set(brew.id, encoded.bytes)
    return brew
  })

  mockBrews = { v: 1, revision: 1, items: records }
}

if (mockMode && mockScenario === 'historyData') seedMockHistoryData()

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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase}${path}`
  const response = !init?.method || init.method === 'GET' ? await sharedFetch(url, init) : await fetch(url, init)
  if (!response.ok) {
    let body: ApiErrorBody = {}
    try { body = await response.json() as ApiErrorBody } catch { /* use status text */ }
    throw new LibraryApiError(response.status, body.error?.code ?? 'request_failed', body.error?.message ?? response.statusText)
  }
  const declaredBytes = Number(response.headers.get('content-length') ?? 0)
  if (declaredBytes > 256 * 1024) throw new LibraryApiError(502, 'response_too_large', 'PourFrame returned more startup data than supported.')
  const text = await response.text()
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > 256 * 1024) throw new LibraryApiError(502, 'response_too_large', 'PourFrame returned more startup data than supported.')
  cacheDebug('api:response', { path, bytes })
  try { return JSON.parse(text) as T } catch { throw new LibraryApiError(502, 'invalid_json', 'PourFrame returned invalid data.') }
}

function normalizeCollection<T>(value: Collection<T>, maximum: number, normalize: (item: T) => T | undefined, name: string): Collection<T> {
  if (!value || value.v !== 1 || !Number.isInteger(value.revision) || value.revision < 0 || !Array.isArray(value.items) || value.items.length > maximum) throw new LibraryApiError(502, 'invalid_collection', `${name} returned an unsupported collection.`)
  const items = value.items.map(normalize)
  if (items.some((item) => !item)) throw new LibraryApiError(502, 'invalid_collection', `${name} returned invalid records.`)
  return { v: 1, revision: value.revision, items: items as T[] }
}

const recipeCollection = (value: Collection<BrewRecipe>) => normalizeCollection(value, 24, (item) => { try { const normalized = migrateRecipe(item); return validateRecipe(normalized).valid ? normalized : undefined } catch { return undefined } }, 'Recipes')
const coffeeBagCollection = (value: Collection<CoffeeBag>) => normalizeCollection(value, 24, (item) => { try { const normalized = normalizeCoffeeBag(item); return validateCoffeeBag(normalized).valid ? normalized : undefined } catch { return undefined } }, 'Coffee bags')
const brewCollection = (value: Collection<BrewRecord>) => normalizeCollection(value, 5, (item) => item && typeof item.id === 'string' && typeof item.completed_at === 'string' && item.recipe ? item : undefined, 'Brew history')

async function readRecipes() {
  if (mockMode) return mockRecipes
  return recipeCollection(await requestJson<Collection<BrewRecipe>>('/api/recipes'))
}

async function readBrews() {
  if (mockMode) return mockBrews
  return brewCollection(await requestJson<Collection<BrewRecord>>('/api/brews?limit=5'))
}

async function readCoffeeBags() {
  if (mockMode) return mockCoffeeBags
  return coffeeBagCollection(await requestJson<Collection<CoffeeBag>>('/api/coffee-bags'))
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
  return recipeCollection(await requestJson<Collection<BrewRecipe>>('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, base_revision: baseRevision, recipe }) }))
}

async function postCoffeeBag(coffeeBag: CoffeeBag, baseRevision: number) {
  coffeeBag = normalizeCoffeeBag(coffeeBag)
  if (mockMode) {
    const found = mockCoffeeBags.items.findIndex((item) => item.id === coffeeBag.id)
    const items = [...mockCoffeeBags.items]
    if (found >= 0) items[found] = coffeeBag; else items.unshift(coffeeBag)
    mockCoffeeBags = { v: 1, revision: mockCoffeeBags.revision + 1, items: items.slice(0, 24) }
    return mockCoffeeBags
  }
  return coffeeBagCollection(await requestJson<Collection<CoffeeBag>>('/api/coffee-bags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, base_revision: baseRevision, coffee_bag: coffeeBag }) }))
}

async function postBrewCompletion(brew: BrewRecord, coffeeBagId: string | undefined, doseG: number | undefined, coffeeBagRevision: number) {
  if (mockMode) {
    if (!mockBrews.items.some((item) => item.id === brew.id)) {
      mockBrews = { v: 1, revision: mockBrews.revision + 1, items: retainNewestBrews([brew, ...mockBrews.items]) }
      if (coffeeBagId && doseG && doseG > 0) {
        mockCoffeeBags = {
          v: 1,
          revision: mockCoffeeBags.revision + 1,
          items: mockCoffeeBags.items.map((bag) => bag.id === coffeeBagId ? { ...bag, remainingWeightG: Math.max(0, bag.remainingWeightG - doseG), updatedAt: new Date().toISOString() } : bag),
        }
      }
    }
    return { v: 1, brews: mockBrews, coffee_bags: mockCoffeeBags } satisfies CompletionResponse
  }
  const coffeeBagUse = coffeeBagId && doseG !== undefined ? { bag_id: coffeeBagId, dose_g: doseG, base_revision: coffeeBagRevision } : null
  const completion = await requestJson<CompletionResponse>('/api/brew-completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, brew, coffee_bag_use: coffeeBagUse }) })
  if (completion.v !== 1) throw new LibraryApiError(502, 'invalid_collection', 'PourFrame returned an unsupported completion response.')
  return { ...completion, brews: brewCollection(completion.brews), coffee_bags: coffeeBagCollection(completion.coffee_bags) }
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
  const cached = await readTraceCache(id).catch(() => undefined)
  if (cached) {
    try { cacheDebug('trace:cache-hit', { id }); return decodeTrace(cached) } catch { /* Replace corrupt optional data. */ }
  }
  const response = await sharedFetch(`${apiBase}/api/brew-traces?id=${encodeURIComponent(id)}`)
  if (!response.ok) throw new LibraryApiError(response.status, 'trace_load_failed', response.status === 404 ? 'This brew trace is unavailable.' : 'The brew trace could not be loaded.')
  const bytes = new Uint8Array(await response.arrayBuffer())
  const decoded = decodeTrace(bytes)
  void putTraceCache(id, bytes).catch(() => cacheDebug('trace:cache-write-failed', { id }))
  return decoded
}

export function legacyDataAvailable() {
  return Boolean(localStorage.getItem('pourover.recipes.v1') || localStorage.getItem('pourover.brewLog.v1')) && localStorage.getItem('pourframe.legacyImported') !== 'true'
}

export function useLibrary() {
  const [recipes, setRecipes] = useState<BrewRecipe[]>(defaultRecipes)
  const [brews, setBrews] = useState<BrewRecord[]>([])
  const [coffeeBags, setCoffeeBags] = useState<CoffeeBag[]>([])
  const [status, setStatus] = useState<LibraryStatus>('loading')
  const [message, setMessage] = useState('Restoring saved PourFrame data…')
  const [hasLegacy, setHasLegacy] = useState(legacyDataAvailable)
  const recipeRevision = useRef(0)
  const brewRevision = useRef(0)
  const coffeeBagRevision = useRef(0)
  const recipesRef = useRef(recipes)
  const brewsRef = useRef(brews)
  const coffeeBagsRef = useRef(coffeeBags)
  const retryAttempt = useRef(0)
  const retryTimer = useRef<number | undefined>(undefined)
  const conflictNotice = useRef(false)
  const refreshRunning = useRef(false)

  useEffect(() => { recipesRef.current = recipes }, [recipes])
  useEffect(() => { brewsRef.current = brews }, [brews])
  useEffect(() => { coffeeBagsRef.current = coffeeBags }, [coffeeBags])

  const publishRecipes = useCallback((collection: Collection<BrewRecipe>) => {
    recipeRevision.current = collection.revision; recipesRef.current = collection.items; setRecipes(collection.items)
  }, [])
  const publishBrews = useCallback((collection: Collection<BrewRecord>) => {
    brewRevision.current = collection.revision; brewsRef.current = collection.items; setBrews(collection.items)
  }, [])
  const publishCoffeeBags = useCallback((collection: Collection<CoffeeBag>) => {
    coffeeBagRevision.current = collection.revision; coffeeBagsRef.current = collection.items; setCoffeeBags(collection.items)
  }, [])

  const syncMutation = useCallback(async (entry: MutationOutboxEntry) => {
    const recipesEntry = entry.collection === 'recipes'
    const latest = recipesEntry ? await readRecipes() : await readCoffeeBags()
    const disposition = mutationDisposition(entry, latest as Collection<{ id: string }>)
    if (disposition === 'already-applied') {
      await deleteOutbox(entry.id)
      if (recipesEntry) publishRecipes(latest as Collection<BrewRecipe>); else publishCoffeeBags(latest as Collection<CoffeeBag>)
      return
    }
    if (disposition === 'conflict') {
      await deleteOutbox(entry.id)
      if (recipesEntry) {
        publishRecipes(latest as Collection<BrewRecipe>)
        await putCachedCollection('recipes', latest as Collection<BrewRecipe>)
      } else {
        publishCoffeeBags(latest as Collection<CoffeeBag>)
        await putCachedCollection('coffee-bags', latest as Collection<CoffeeBag>)
      }
      setStatus('cached'); setMessage('A newer PourFrame version was kept for one conflicting record.')
      conflictNotice.current = true
      setStartupState('espSync', 'conflict')
      cacheDebug('sync:esp-wins', { collection: entry.collection, recordId: entry.recordId })
      return
    }
    if (recipesEntry) {
      const saved = entry.operation === 'delete'
        ? recipeCollection(await requestJson<Collection<BrewRecipe>>(`/api/recipes?id=${encodeURIComponent(entry.recordId)}&base_revision=${latest.revision}`, { method: 'DELETE' }))
        : await postRecipe(entry.payload as BrewRecipe, latest.revision)
      publishRecipes(saved)
      await commitCollectionAndDeleteOutbox('recipes', saved, entry.id)
    } else {
      const saved = entry.operation === 'delete'
        ? coffeeBagCollection(await requestJson<Collection<CoffeeBag>>(`/api/coffee-bags?id=${encodeURIComponent(entry.recordId)}&base_revision=${latest.revision}`, { method: 'DELETE' }))
        : await postCoffeeBag(entry.payload as CoffeeBag, latest.revision)
      publishCoffeeBags(saved)
      await commitCollectionAndDeleteOutbox('coffee-bags', saved, entry.id)
    }
    cacheDebug('sync:mutation-complete', { collection: entry.collection, operation: entry.operation })
  }, [publishCoffeeBags, publishRecipes])

  const syncBrew = useCallback(async (entry: BrewOutboxEntry) => {
    if (entry.trace) await putTrace(entry.record.id, entry.trace)
    let completion: CompletionResponse
    try {
      completion = await postBrewCompletion(entry.record, entry.coffeeBagId, entry.doseG, coffeeBagRevision.current)
    } catch (error) {
      if (!(error instanceof LibraryApiError) || error.status !== 409) throw error
      const latest = await readCoffeeBags()
      publishCoffeeBags(latest)
      completion = await postBrewCompletion(entry.record, undefined, undefined, latest.revision)
      cacheDebug('sync:inventory-esp-wins', { brewId: entry.record.id, coffeeBagId: entry.coffeeBagId })
    }
    publishBrews(completion.brews); publishCoffeeBags(completion.coffee_bags)
    await Promise.all([commitCollectionAndDeleteOutbox('brews', completion.brews, entry.id), putCachedCollection('coffee-bags', completion.coffee_bags)])
    return completion.inventory_warning
  }, [publishBrews, publishCoffeeBags])

  const refresh = useCallback(async () => {
    if (refreshRunning.current) { cacheDebug('sync:deduplicated'); return }
    refreshRunning.current = true
    setStartupState('espSync', 'running')
    conflictNotice.current = false
    try {
      if (!mockMode && !await espHealthProbe()) throw new LibraryApiError(0, 'device_offline', 'PourFrame is offline.')
      let [recipeCollection, brewCollection, coffeeBagCollection] = await Promise.all([readRecipes(), readBrews(), readCoffeeBags()])
      recipeCollection = { ...recipeCollection, items: recipeCollection.items.map(migrateRecipe) }
      brewCollection = { ...brewCollection, items: retainNewestBrews(brewCollection.items) }
      coffeeBagCollection = { ...coffeeBagCollection, items: coffeeBagCollection.items.map(normalizeCoffeeBag) }
      if (recipeCollection.items.length === 0) for (const recipe of defaultRecipes) recipeCollection = await postRecipe(recipe, recipeCollection.revision)
      if (coffeeBagCollection.items.length === 0) for (const coffeeBag of defaultCoffeeBags) coffeeBagCollection = await postCoffeeBag(coffeeBag, coffeeBagCollection.revision)
      const pending = await readOutbox()
      const recipeMutations = pending.filter((item): item is MutationOutboxEntry => item.kind === 'mutation' && item.collection === 'recipes')
      const bagMutations = pending.filter((item): item is MutationOutboxEntry => item.kind === 'mutation' && item.collection === 'coffee-bags')
      publishRecipes({ ...recipeCollection, items: applyMutationProjection(recipeCollection.items, recipeMutations) })
      publishBrews(brewCollection)
      publishCoffeeBags({ ...coffeeBagCollection, items: applyMutationProjection(coffeeBagCollection.items, bagMutations) })
      await Promise.all([putCachedCollection('recipes', recipeCollection), putCachedCollection('brews', brewCollection), putCachedCollection('coffee-bags', coffeeBagCollection)])
      for (const entry of pending) {
        if (entry.kind === 'mutation') await syncMutation(entry)
        else await syncBrew(entry)
      }
      retryAttempt.current = 0
      if (conflictNotice.current) {
        setStatus('cached'); setMessage('A newer PourFrame version was kept for one conflicting record.')
        setStartupState('espSync', 'conflict')
      } else {
        setStatus('ready'); setMessage('Shared data is stored on PourFrame')
        setStartupState('espSync', 'complete')
      }
    } catch (error) {
      const hasCached = recipeRevision.current > 0 || recipesRef.current !== defaultRecipes
      setStatus(hasCached ? 'cached' : 'error')
      setMessage(hasCached ? 'Using saved browser data while PourFrame is offline.' : error instanceof Error ? error.message : 'Shared data is unavailable')
      setStartupState('espSync', error instanceof LibraryApiError && error.code === 'device_offline' ? 'offline' : 'failed')
      const delays = [2_000, 5_000, 15_000, 60_000]
      const delay = delays[Math.min(retryAttempt.current++, delays.length - 1)] * (.85 + Math.random() * .3)
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current)
      retryTimer.current = window.setTimeout(() => { if (document.visibilityState === 'visible') void refresh() }, delay)
    } finally {
      refreshRunning.current = false
    }
  }, [publishBrews, publishCoffeeBags, publishRecipes, syncBrew, syncMutation])

  useEffect(() => {
    let active = true
    void Promise.all([readCachedCollections(), readOutbox()]).then(([cached, pending]) => {
      if (!active) return
      const recipeMutations = pending.filter((item): item is MutationOutboxEntry => item.kind === 'mutation' && item.collection === 'recipes')
      const bagMutations = pending.filter((item): item is MutationOutboxEntry => item.kind === 'mutation' && item.collection === 'coffee-bags')
      if (cached.recipes) publishRecipes({ ...cached.recipes, items: applyMutationProjection(cached.recipes.items, recipeMutations) })
      if (cached.brews) publishBrews(cached.brews)
      if (cached.coffeeBags) publishCoffeeBags({ ...cached.coffeeBags, items: applyMutationProjection(cached.coffeeBags.items, bagMutations) })
      const found = Boolean(cached.recipes || cached.brews || cached.coffeeBags)
      setStartupState('localData', found ? 'ready' : 'unavailable')
      if (found) { setStatus('cached'); setMessage('Using saved browser data while checking PourFrame.') }
      cacheDebug('local-data:restored', { cached: found, pending: pending.length })
    }).catch(() => setStartupState('localData', 'unavailable')).finally(() => { if (active) void refresh() })
    return () => { active = false }
  }, [publishBrews, publishCoffeeBags, publishRecipes, refresh])

  useEffect(() => {
    const reconnect = () => { retryAttempt.current = 0; void refresh() }
    const visible = () => { if (document.visibilityState === 'visible') reconnect() }
    window.addEventListener('online', reconnect)
    window.addEventListener('pourframe:device-reconnected', reconnect)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', reconnect); window.removeEventListener('pourframe:device-reconnected', reconnect); document.removeEventListener('visibilitychange', visible)
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current)
    }
  }, [refresh])

  const queueMutation = useCallback(async <T extends BrewRecipe | CoffeeBag>(collection: MutableCollection, operation: 'upsert' | 'delete', recordId: string, payload: T | undefined, baseRevision: number, baseRecord: T | undefined) => {
    const id = `${collection}:${recordId}`
    const previous = (await readOutbox().catch(() => [])).find((item) => item.id === id && item.kind === 'mutation') as MutationOutboxEntry | undefined
    const entry: MutationOutboxEntry<T> = { schemaVersion: 2, id, sequence: previous?.sequence ?? Date.now(), kind: 'mutation', collection, recordId, operation, payload, baseRevision: previous?.baseRevision ?? baseRevision, baseRecord: (previous?.baseRecord as T | undefined) ?? baseRecord, createdAt: previous?.createdAt ?? new Date().toISOString(), attempts: previous?.attempts ?? 0 }
    try { await putOutbox(entry) } catch {
      setStatus('cached'); setMessage('This change is only held for this session because browser storage is unavailable.')
      cacheDebug('outbox:durability-failed', { collection, operation, recordId }); return
    }
    try { await syncMutation(entry) } catch (error) {
      if (error instanceof LibraryApiError && error.status > 0 && error.status < 500 && error.status !== 409) { await deleteOutbox(entry.id); throw error }
      setStatus('cached'); setMessage('Change saved in this browser and waiting for PourFrame.')
      cacheDebug('outbox:queued', { collection, operation, recordId })
    }
  }, [syncMutation])

  const saveRecipe = useCallback(async (recipe: BrewRecipe) => {
    recipe = migrateRecipe(recipe)
    const baseRecord = recipesRef.current.find((item) => item.id === recipe.id)
    const projected = [recipe, ...recipesRef.current.filter((item) => item.id !== recipe.id)].slice(0, 24)
    publishRecipes({ v: 1, revision: recipeRevision.current, items: projected })
    await queueMutation('recipes', 'upsert', recipe.id, recipe, recipeRevision.current, baseRecord)
  }, [publishRecipes, queueMutation])

  const deleteRecipe = useCallback(async (id: string) => {
    if (mockMode) { mockRecipes = { ...mockRecipes, revision: mockRecipes.revision + 1, items: mockRecipes.items.filter((item) => item.id !== id) }; publishRecipes(mockRecipes); return }
    const baseRecord = recipesRef.current.find((item) => item.id === id)
    const projected = recipesRef.current.filter((item) => item.id !== id)
    publishRecipes({ v: 1, revision: recipeRevision.current, items: projected })
    await queueMutation('recipes', 'delete', id, undefined, recipeRevision.current, baseRecord)
  }, [publishRecipes, queueMutation])

  const saveCoffeeBag = useCallback(async (coffeeBag: CoffeeBag) => {
    coffeeBag = normalizeCoffeeBag(coffeeBag)
    const baseRecord = coffeeBagsRef.current.find((item) => item.id === coffeeBag.id)
    const projected = [coffeeBag, ...coffeeBagsRef.current.filter((item) => item.id !== coffeeBag.id)].slice(0, 24)
    publishCoffeeBags({ v: 1, revision: coffeeBagRevision.current, items: projected })
    await queueMutation('coffee-bags', 'upsert', coffeeBag.id, coffeeBag, coffeeBagRevision.current, baseRecord)
  }, [publishCoffeeBags, queueMutation])

  const deleteCoffeeBag = useCallback(async (id: string) => {
    if (mockMode) { mockCoffeeBags = { ...mockCoffeeBags, revision: mockCoffeeBags.revision + 1, items: mockCoffeeBags.items.filter((item) => item.id !== id) }; publishCoffeeBags(mockCoffeeBags); return }
    const baseRecord = coffeeBagsRef.current.find((item) => item.id === id)
    const projected = coffeeBagsRef.current.filter((item) => item.id !== id)
    publishCoffeeBags({ v: 1, revision: coffeeBagRevision.current, items: projected })
    await queueMutation('coffee-bags', 'delete', id, undefined, coffeeBagRevision.current, baseRecord)
  }, [publishCoffeeBags, queueMutation])

  const saveBrew = useCallback(async (brew: BrewRecord, trace?: Uint8Array, coffeeBagId?: string, doseG?: number) => {
    const pending: BrewOutboxEntry = { schemaVersion: 2, id: brew.id, sequence: Date.now(), kind: 'brew', record: brew, trace: trace?.buffer.slice(trace.byteOffset, trace.byteOffset + trace.byteLength) as ArrayBuffer | undefined, coffeeBagId, doseG, createdAt: new Date().toISOString(), attempts: 0 }
    const projected = retainNewestBrews([brew, ...brewsRef.current.filter((item) => item.id !== brew.id)])
    publishBrews({ v: 1, revision: brewRevision.current, items: projected })
    try { await putOutbox(pending) } catch {
      setStatus('cached'); setMessage('This brew is only held for this session because browser storage is unavailable.')
      cacheDebug('outbox:durability-failed', { collection: 'brews', recordId: brew.id }); return undefined
    }
    try { return await syncBrew(pending) } catch (error) {
      if (error instanceof LibraryApiError && error.status > 0 && error.status < 500 && error.status !== 409) { await deleteOutbox(pending.id); throw error }
      setStatus('cached'); setMessage('Brew saved in this browser and waiting for PourFrame.')
      return undefined
    }
  }, [publishBrews, syncBrew])

  const clearBrews = useCallback(async () => {
    if (mockMode) { mockBrews = { v: 1, revision: mockBrews.revision + 1, items: [] }; publishBrews(mockBrews); return }
    const collection = brewCollection(await requestJson<Collection<BrewRecord>>(`/api/brews?confirm=clear&base_revision=${brewRevision.current}`, { method: 'DELETE' }))
    publishBrews(collection); await putCachedCollection('brews', collection)
  }, [publishBrews])

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

  return { recipes, brews, coffeeBags, status, message, hasLegacy, refresh, saveRecipe, deleteRecipe, saveCoffeeBag, deleteCoffeeBag, saveBrew, clearBrews, importLegacy }
}
