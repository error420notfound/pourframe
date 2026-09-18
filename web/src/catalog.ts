import { migrateRecipe, normalizeRecipe, validateRecipe } from './brew'
import type { BrewRecipe, CoffeeBag, GrindSize, RoastLevel } from './brewTypes'

export const DEFAULT_CATALOG_BASE_URL = 'https://raw.githubusercontent.com/error420notfound/pourframe-catalog/main/catalogue'
export const CATALOG_REPOSITORY_URL = 'https://github.com/error420notfound/pourframe-catalog'
export const CATALOG_TIMEOUT_MS = 5_000
export const CATALOG_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000
export const CATALOG_CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1_000
const CATALOG_CACHE_MAX_BYTES = 5 * 1024 * 1024
const CATALOG_COFFEE_DETAIL_LIMIT = 50
const CATALOG_RECIPE_DETAIL_LIMIT = 25
const catalogLastUsedKey = 'pourframe.catalog.last-used.v1'

const roastLevels: RoastLevel[] = ['Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark']
const grindSizes: GrindSize[] = ['Fine', 'Medium-fine', 'Medium', 'Medium-coarse', 'Coarse']
const serveStyles = ['hot', 'iced'] as const
const catalogStatuses = ['available', 'seasonal', 'sold-out', 'archived', 'unknown'] as const
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/

export type CatalogStatus = typeof catalogStatuses[number]

export interface CatalogVersion { schemaVersion: 1; catalogVersion: string; updatedAt: string }
export interface CatalogRoasterySummary {
  id: string; name: string; country?: string; city?: string; logoUrl?: string; path: string; sortOrder?: number
}
export interface CatalogRoastery {
  id: string; name: string; country?: string; city?: string; website?: string; logoUrl?: string; instagram?: string
  description?: string; active?: boolean; sortOrder?: number
}
export interface CatalogRoasteryIndex { schemaVersion: 1; roasteries: CatalogRoasterySummary[]; discardedRecords: number }
export interface CatalogCoffeeSummary {
  id: string; name: string; status: CatalogStatus; path: string; featured?: boolean; sortOrder?: number; updatedAt: string
}
export interface CatalogRoasteryCoffeeIndex { schemaVersion: 1; roastery: CatalogRoastery; coffees: CatalogCoffeeSummary[]; discardedRecords: number }
export interface CatalogOrigin { country?: string; region?: string }
export interface CatalogAltitudeRange { min: number; max: number }
export interface CatalogPrice { amount: number; currency: string }
export interface CatalogSource { url: string; checkedAt: string }
export interface CatalogCoffee {
  schemaVersion: 1; id: string; name: string; roasteryId: string; status: CatalogStatus; origin?: CatalogOrigin; farm?: string
  altitudeM?: number; altitudeRangeM?: CatalogAltitudeRange; processing?: string[]; varieties?: string[]; roastLevel?: RoastLevel
  tastingNotes?: string[]; price?: CatalogPrice; bagSizeG?: number; productUrl?: string; imageUrl?: string; featured?: boolean
  sortOrder?: number; description?: string; source: CatalogSource; updatedAt: string
}
export interface CatalogRecipeSummary { id: string; name: string; dripper: string; serveStyle: 'hot' | 'iced'; path: string; publishedAt: string; updatedAt: string }
export interface CatalogRecipeIndex { schemaVersion: 1; recipes: CatalogRecipeSummary[] }
export interface CatalogRecipe {
  schemaVersion: 1; id: string; name: string; dripper: string; coffee: number; water: number; ratio: number; grind: GrindSize; bloom: number
  poursAfterBloom: number; brewTime: number; flowRate: number; temperature: number; agitation: string; equipment: string[]; notes: string; serveStyle: 'hot' | 'iced'
}

export interface CatalogCacheEntry<T> { data: T; responseUrl?: string; sourceUrl?: string; catalogVersion?: string; fetchedAt: string; accessedAt?: string }
export interface CatalogCache { get<T>(key: string): Promise<CatalogCacheEntry<T> | undefined>; set<T>(key: string, value: CatalogCacheEntry<T>): Promise<void> }
export interface CatalogDependencies {
  fetch?: typeof fetch; cache?: CatalogCache; baseUrl?: string; timeoutMs?: number; cacheMaxAgeMs?: number; now?: () => number
}
export interface CatalogLoad<T> {
  data: T; source: 'network' | 'cached'; fetchedAt: string; catalogVersion?: string; discardedRecords: number; refresh?: Promise<CatalogLoad<T>>
}

export class CatalogError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function requiredString(value: unknown, maximum: number, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new CatalogError(`The catalog ${name} is invalid.`)
  return value.trim()
}

function optionalString(value: unknown, maximum: number, name: string): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, maximum, name)
}

function requiredNumber(value: unknown, minimum: number, maximum: number, name: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) throw new CatalogError(`The catalog ${name} is invalid.`)
  return value
}

function optionalNumber(value: unknown, minimum: number, maximum: number, name: string, integer = false): number | undefined {
  if (value === undefined) return undefined
  return requiredNumber(value, minimum, maximum, name, integer)
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new CatalogError(`The catalog ${name} is invalid.`)
  return value
}

function requiredArray(value: unknown, maximum: number, name: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new CatalogError(`The catalog ${name} is invalid.`)
  return value
}

function optionalStringArray(value: unknown, maximum: number, itemMaximum: number, name: string): string[] | undefined {
  if (value === undefined) return undefined
  return requiredArray(value, maximum, name).map((item) => requiredString(item, itemMaximum, name))
}

function requiredDate(value: unknown, name: string): string {
  const date = requiredString(value, 10, name)
  if (!datePattern.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new CatalogError(`The catalog ${name} is invalid.`)
  return date
}

function schema(value: Record<string, unknown>) {
  if (value.schemaVersion !== 1) throw new CatalogError('This catalog uses an unsupported format.')
}

function catalogId(value: unknown, name: string): string {
  const id = requiredString(value, 64, name)
  if (!idPattern.test(id)) throw new CatalogError(`The catalog ${name} is invalid.`)
  return id
}

export function safeCatalogUrl(value: unknown, name: string): string {
  const raw = requiredString(value, 2_000, name)
  let url: URL
  try { url = new URL(raw) } catch { throw new CatalogError(`The catalog ${name} is invalid.`) }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) throw new CatalogError(`The catalog ${name} is invalid.`)
  return url.href
}

export function safeCatalogPath(value: unknown): string {
  const path = requiredString(value, 240, 'path')
  if (!path.endsWith('.json') || path.startsWith('/') || path.includes('..') || path.includes('\\') || /[:?#]/.test(path) || !/^[a-z0-9][a-z0-9/-]*\.json$/.test(path)) throw new CatalogError('The catalog referenced an unsafe file path.')
  return path
}

function roasteryPath(value: unknown, id: string): string {
  const path = safeCatalogPath(value)
  if (path !== `roasteries/${id}/index.json`) throw new CatalogError('The catalog referenced an invalid roastery path.')
  return path
}

function coffeePath(value: unknown, roasteryId: string, coffeeId: string): string {
  const path = safeCatalogPath(value)
  if (path !== `roasteries/${roasteryId}/coffees/${coffeeId}.json`) throw new CatalogError('The catalog referenced an invalid coffee path.')
  return path
}

export function catalogBaseUrl(configured = import.meta.env.VITE_CATALOG_BASE_URL): string {
  const raw = configured?.trim() || DEFAULT_CATALOG_BASE_URL
  let url: URL
  try { url = new URL(raw) } catch { throw new CatalogError('The catalog address is invalid.') }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.hash || url.search) throw new CatalogError('The catalog address is invalid.')
  return url.href.replace(/\/+$/, '')
}

export function catalogUrl(path: string, base = catalogBaseUrl()): string {
  const safePath = safeCatalogPath(path)
  const root = new URL(`${catalogBaseUrl(base)}/`)
  const resolved = new URL(safePath, root)
  if (resolved.origin !== root.origin || !resolved.pathname.startsWith(root.pathname)) throw new CatalogError('The catalog referenced an unsafe file path.')
  return resolved.href
}

function parseRoastery(value: unknown, summary = false): CatalogRoastery | CatalogRoasterySummary {
  const item = record(value); if (!item) throw new CatalogError('The catalog roastery is invalid.')
  const id = catalogId(item.id, 'roastery ID')
  const common = {
    id,
    name: requiredString(item.name, 120, 'roastery name'),
    country: optionalString(item.country, 80, 'roastery country'),
    city: optionalString(item.city, 80, 'roastery city'),
    logoUrl: item.logoUrl === undefined ? undefined : safeCatalogUrl(item.logoUrl, 'roastery logo URL'),
    sortOrder: optionalNumber(item.sortOrder, 0, 1_000_000, 'roastery sort order', true),
  }
  if (summary) return { ...common, path: roasteryPath(item.path, id) }
  return {
    ...common,
    website: item.website === undefined ? undefined : safeCatalogUrl(item.website, 'roastery website'),
    instagram: optionalString(item.instagram, 80, 'roastery Instagram'),
    description: optionalString(item.description, 500, 'roastery description'),
    active: optionalBoolean(item.active, 'roastery active status'),
  }
}

function parseCoffeeSummary(value: unknown, roasteryId: string): CatalogCoffeeSummary {
  const item = record(value); if (!item) throw new CatalogError('The catalog coffee index is invalid.')
  const id = catalogId(item.id, 'coffee ID')
  const status = requiredString(item.status, 20, 'coffee status')
  if (!catalogStatuses.includes(status as CatalogStatus)) throw new CatalogError('The catalog coffee status is invalid.')
  return {
    id,
    name: requiredString(item.name, 120, 'coffee name'),
    status: status as CatalogStatus,
    path: coffeePath(item.path, roasteryId, id),
    featured: optionalBoolean(item.featured, 'coffee featured status'),
    sortOrder: optionalNumber(item.sortOrder, 0, 1_000_000, 'coffee sort order', true),
    updatedAt: requiredDate(item.updatedAt, 'coffee update date'),
  }
}

function parseRecipeSummary(value: unknown): CatalogRecipeSummary {
  const item = record(value); if (!item) throw new CatalogError('The catalog recipe index is invalid.')
  const serveStyle = requiredString(item.serveStyle, 10, 'recipe serving style')
  if (!serveStyles.includes(serveStyle as 'hot' | 'iced')) throw new CatalogError('The catalog recipe serving style is invalid.')
  return { id: catalogId(item.id, 'recipe ID'), name: requiredString(item.name, 80, 'recipe name'), dripper: requiredString(item.dripper, 80, 'recipe dripper'), serveStyle: serveStyle as 'hot' | 'iced', path: safeCatalogPath(item.path), publishedAt: requiredDate(item.publishedAt, 'recipe publication date'), updatedAt: requiredDate(item.updatedAt, 'recipe update date') }
}

function parseIndexRecords<T>(items: unknown, maximum: number, parser: (value: unknown) => T, name: string): { values: T[]; discardedRecords: number } {
  const values: T[] = []
  let discardedRecords = 0
  for (const item of requiredArray(items, maximum, name)) {
    try { values.push(parser(item)) } catch { discardedRecords += 1 }
  }
  return { values, discardedRecords }
}

export function validateCatalogVersion(raw: unknown): CatalogVersion {
  const item = record(raw); if (!item) throw new CatalogError('The catalog version is invalid.'); schema(item)
  return { schemaVersion: 1, catalogVersion: requiredString(item.catalogVersion, 40, 'version'), updatedAt: requiredDate(item.updatedAt, 'update date') }
}

export function validateRoasteryIndex(raw: unknown): CatalogRoasteryIndex {
  const item = record(raw); if (!item) throw new CatalogError('The catalog roastery index is invalid.'); schema(item)
  const parsed = parseIndexRecords(item.roasteries, 500, (entry) => parseRoastery(entry, true) as CatalogRoasterySummary, 'roasteries')
  return { schemaVersion: 1, roasteries: parsed.values, discardedRecords: parsed.discardedRecords }
}

export function validateRoasteryCoffeeIndex(raw: unknown): CatalogRoasteryCoffeeIndex {
  const item = record(raw); if (!item) throw new CatalogError('The catalog coffee index is invalid.'); schema(item)
  const roastery = parseRoastery(item.roastery) as CatalogRoastery
  const parsed = parseIndexRecords(item.coffees, 500, (entry) => parseCoffeeSummary(entry, roastery.id), 'coffees')
  return { schemaVersion: 1, roastery, coffees: parsed.values, discardedRecords: parsed.discardedRecords }
}

export function validateCatalogCoffee(raw: unknown): CatalogCoffee {
  const item = record(raw); if (!item) throw new CatalogError('The catalog coffee is invalid.'); schema(item)
  const status = requiredString(item.status, 20, 'coffee status')
  if (!catalogStatuses.includes(status as CatalogStatus)) throw new CatalogError('The catalog coffee status is invalid.')
  const originValue = item.origin === undefined ? undefined : record(item.origin)
  if (item.origin !== undefined && !originValue) throw new CatalogError('The catalog coffee origin is invalid.')
  const origin = originValue ? { country: optionalString(originValue.country, 80, 'coffee country'), region: optionalString(originValue.region, 120, 'coffee region') } : undefined
  if (origin && !origin.country && !origin.region) throw new CatalogError('The catalog coffee origin is invalid.')
  const rangeValue = item.altitudeRangeM === undefined ? undefined : record(item.altitudeRangeM)
  if (item.altitudeRangeM !== undefined && !rangeValue) throw new CatalogError('The catalog coffee altitude range is invalid.')
  const altitudeRangeM = rangeValue ? { min: requiredNumber(rangeValue.min, 0, 5_000, 'coffee altitude range minimum'), max: requiredNumber(rangeValue.max, 0, 5_000, 'coffee altitude range maximum') } : undefined
  if (altitudeRangeM && altitudeRangeM.min > altitudeRangeM.max) throw new CatalogError('The catalog coffee altitude range is invalid.')
  const roastLevel = item.roastLevel === undefined ? undefined : requiredString(item.roastLevel, 20, 'coffee roast level')
  if (roastLevel && !roastLevels.includes(roastLevel as RoastLevel)) throw new CatalogError('The catalog coffee roast level is invalid.')
  const priceValue = item.price === undefined ? undefined : record(item.price)
  if (item.price !== undefined && !priceValue) throw new CatalogError('The catalog coffee price is invalid.')
  const price = priceValue ? { amount: requiredNumber(priceValue.amount, 0, 1_000_000, 'coffee price'), currency: requiredString(priceValue.currency, 3, 'coffee currency') } : undefined
  if (price && !/^[A-Z]{3}$/.test(price.currency)) throw new CatalogError('The catalog coffee price is invalid.')
  const sourceValue = record(item.source); if (!sourceValue) throw new CatalogError('The catalog coffee source is invalid.')
  return {
    schemaVersion: 1, id: catalogId(item.id, 'coffee ID'), name: requiredString(item.name, 120, 'coffee name'), roasteryId: catalogId(item.roasteryId, 'roastery ID'), status: status as CatalogStatus, origin,
    farm: optionalString(item.farm, 120, 'coffee farm'), altitudeM: optionalNumber(item.altitudeM, 0, 5_000, 'coffee altitude'), altitudeRangeM,
    processing: optionalStringArray(item.processing, 5, 80, 'coffee processing'), varieties: optionalStringArray(item.varieties, 8, 80, 'coffee varieties'), roastLevel: roastLevel as RoastLevel | undefined,
    tastingNotes: optionalStringArray(item.tastingNotes, 10, 80, 'coffee tasting notes'), price, bagSizeG: optionalNumber(item.bagSizeG, .1, 5_000, 'coffee bag size'),
    productUrl: item.productUrl === undefined ? undefined : safeCatalogUrl(item.productUrl, 'coffee product URL'), imageUrl: item.imageUrl === undefined ? undefined : safeCatalogUrl(item.imageUrl, 'coffee image URL'),
    featured: optionalBoolean(item.featured, 'coffee featured status'), sortOrder: optionalNumber(item.sortOrder, 0, 1_000_000, 'coffee sort order', true), description: optionalString(item.description, 500, 'coffee description'),
    source: { url: safeCatalogUrl(sourceValue.url, 'coffee source URL'), checkedAt: requiredDate(sourceValue.checkedAt, 'coffee source check date') }, updatedAt: requiredDate(item.updatedAt, 'coffee update date'),
  }
}

export function validateRecipeIndex(raw: unknown): CatalogRecipeIndex {
  const item = record(raw); if (!item) throw new CatalogError('The catalog recipe index is invalid.'); schema(item)
  return { schemaVersion: 1, recipes: requiredArray(item.recipes, 500, 'recipes').map(parseRecipeSummary) }
}

export function validateCatalogRecipe(raw: unknown): CatalogRecipe {
  const item = record(raw); if (!item) throw new CatalogError('The catalog recipe is invalid.'); schema(item)
  const grind = requiredString(item.grind, 20, 'recipe grind')
  const serveStyle = requiredString(item.serveStyle, 10, 'recipe serving style')
  if (!grindSizes.includes(grind as GrindSize) || !serveStyles.includes(serveStyle as 'hot' | 'iced')) throw new CatalogError('The catalog recipe is invalid.')
  return {
    schemaVersion: 1, id: catalogId(item.id, 'recipe ID'), name: requiredString(item.name, 80, 'recipe name'), dripper: requiredString(item.dripper, 80, 'recipe dripper'), coffee: requiredNumber(item.coffee, .1, 80, 'recipe coffee'), water: requiredNumber(item.water, .1, 1_200, 'recipe water'), ratio: requiredNumber(item.ratio, .1, 30, 'recipe ratio'), grind: grind as GrindSize,
    bloom: requiredNumber(item.bloom, .1, 1_200, 'recipe bloom'), poursAfterBloom: requiredNumber(item.poursAfterBloom, 1, 6, 'recipe pours', true), brewTime: requiredNumber(item.brewTime, 90, 420, 'recipe brew time', true), flowRate: requiredNumber(item.flowRate, 1, 8, 'recipe flow rate'), temperature: requiredNumber(item.temperature, 80, 100, 'recipe temperature', true), agitation: requiredString(item.agitation, 200, 'recipe agitation'), equipment: requiredArray(item.equipment, 12, 'recipe equipment').map((part) => requiredString(part, 80, 'recipe equipment')), notes: requiredString(item.notes, 500, 'recipe notes'), serveStyle: serveStyle as 'hot' | 'iced',
  }
}

class IndexedDbCatalogCache implements CatalogCache {
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('pourframe-catalog-v1', 2)
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('responses')) request.result.createObjectStore('responses') }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  async get<T>(key: string): Promise<CatalogCacheEntry<T> | undefined> {
    const database = await this.open()
    return new Promise<CatalogCacheEntry<T> | undefined>((resolve, reject) => {
      const request = database.transaction('responses').objectStore('responses').get(key)
      request.onsuccess = () => resolve(request.result as CatalogCacheEntry<T> | undefined)
      request.onerror = () => reject(request.error)
    }).finally(() => database.close()).then(async (entry) => {
      if (!entry) return undefined
      if (Date.now() - Date.parse(entry.fetchedAt) > CATALOG_CACHE_EXPIRY_MS) { await this.delete(key).catch(() => undefined); return undefined }
      void this.set(key, { ...entry, accessedAt: new Date().toISOString() }, false).catch(() => undefined)
      return entry
    })
  }
  async set<T>(key: string, value: CatalogCacheEntry<T>, cleanup = true): Promise<void> {
    const database = await this.open()
    return new Promise<void>((resolve, reject) => {
      const request = database.transaction('responses', 'readwrite').objectStore('responses').put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    }).finally(() => database.close())
    if (cleanup) await this.cleanup().catch(() => undefined)
  }
  private async delete(key: string) {
    const database = await this.open()
    return new Promise<void>((resolve, reject) => {
      const request = database.transaction('responses', 'readwrite').objectStore('responses').delete(key)
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error)
    }).finally(() => database.close())
  }
  private async cleanup() {
    const database = await this.open()
    const entries = await new Promise<Array<{ key: string; value: CatalogCacheEntry<unknown> }>>((resolve, reject) => {
      const output: Array<{ key: string; value: CatalogCacheEntry<unknown> }> = []
      const request = database.transaction('responses').objectStore('responses').openCursor()
      request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(output); return }; output.push({ key: String(cursor.key), value: cursor.value as CatalogCacheEntry<unknown> }); cursor.continue() }
      request.onerror = () => reject(request.error)
    }).finally(() => database.close())
    const now = Date.now()
    const sorted = entries.sort((a, b) => Date.parse(b.value.accessedAt ?? b.value.fetchedAt) - Date.parse(a.value.accessedAt ?? a.value.fetchedAt))
    let total = 0; let coffees = 0; let recipes = 0
    for (const entry of sorted) {
      const bytes = new Blob([JSON.stringify(entry.value)]).size
      const coffeeDetail = /\/coffees\/[^/]+\.json$/.test(entry.key)
      const recipeDetail = /\/recipes\/[^/]+\.json$/.test(entry.key) && !entry.key.endsWith('/recipes/index.json')
      if (coffeeDetail) coffees += 1
      if (recipeDetail) recipes += 1
      total += bytes
      if (now - Date.parse(entry.value.fetchedAt) > CATALOG_CACHE_EXPIRY_MS || total > CATALOG_CACHE_MAX_BYTES || (coffeeDetail && coffees > CATALOG_COFFEE_DETAIL_LIMIT) || (recipeDetail && recipes > CATALOG_RECIPE_DETAIL_LIMIT)) await this.delete(entry.key)
    }
  }
}

export function markCatalogUsed(now = Date.now()) { try { localStorage.setItem(catalogLastUsedKey, String(now)) } catch { /* optional metadata */ } }
export function catalogRecentlyUsed(now = Date.now()) {
  try { const used = Number(localStorage.getItem(catalogLastUsedKey)); return Number.isFinite(used) && now - used <= CATALOG_CACHE_EXPIRY_MS } catch { return false }
}

function browserCache(): CatalogCache {
  if (typeof indexedDB === 'undefined') return { get: async () => undefined, set: async () => undefined }
  return new IndexedDbCatalogCache()
}

function abortError(reason?: unknown): Error { return reason instanceof Error ? reason : new DOMException('The catalog request was cancelled.', 'AbortError') }

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
  const timeout = globalThis.setTimeout(() => controller.abort(new CatalogError('The catalog request took too long.')), timeoutMs)
  return { signal: controller.signal, dispose: () => { globalThis.clearTimeout(timeout); signal?.removeEventListener('abort', abort) } }
}

function acceptsJson(response: Response, url: string): boolean {
  const contentType = response.headers.get('content-type')?.toLocaleLowerCase() ?? ''
  if (contentType.includes('application/json') || contentType.includes('+json') || contentType.includes('text/json')) return true
  try { return new URL(url).hostname === 'raw.githubusercontent.com' && contentType.startsWith('text/plain') } catch { return false }
}

async function readJson(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw abortError(signal.reason)
  const response = await fetcher(url, { signal, headers: { Accept: 'application/json' } })
  if (signal.aborted) throw abortError(signal.reason)
  if (!response.ok) throw new CatalogError('The PourFrame Catalog is unavailable right now.')
  if (!acceptsJson(response, url)) throw new CatalogError('The catalog returned an unsupported response.')
  try { return await response.json() as unknown } catch { throw new CatalogError('The catalog returned invalid data.') }
}

function discardedRecords(value: unknown): number {
  const parsed = record(value)?.discardedRecords
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

export class CatalogClient {
  private readonly fetcher: typeof fetch
  private readonly cache: CatalogCache
  private readonly base: string
  private readonly timeoutMs: number
  private readonly cacheMaxAgeMs: number
  private readonly now: () => number
  private versionRequest: Promise<string | undefined> | undefined

  constructor(dependencies: CatalogDependencies = {}) {
    this.fetcher = dependencies.fetch ?? fetch
    this.cache = dependencies.cache ?? browserCache()
    this.base = catalogBaseUrl(dependencies.baseUrl)
    this.timeoutMs = dependencies.timeoutMs ?? CATALOG_TIMEOUT_MS
    this.cacheMaxAgeMs = dependencies.cacheMaxAgeMs ?? CATALOG_CACHE_MAX_AGE_MS
    this.now = dependencies.now ?? Date.now
  }

  private async remote<T>(path: string, validate: (raw: unknown) => T, signal?: AbortSignal): Promise<T> {
    const timed = timeoutSignal(signal, this.timeoutMs)
    try { return validate(await readJson(this.fetcher, catalogUrl(path, this.base), timed.signal)) } finally { timed.dispose() }
  }

  private catalogVersion(signal?: AbortSignal): Promise<string | undefined> {
    if (!this.versionRequest) this.versionRequest = this.remote('version.json', validateCatalogVersion, signal).then((version) => version.catalogVersion).catch(() => undefined)
    return this.versionRequest
  }

  private cached<T>(entry: CatalogCacheEntry<unknown> | undefined, key: string, validate: (raw: unknown) => T): { data: T; fetchedAt: string; catalogVersion?: string } | undefined {
    if (!entry || typeof entry.fetchedAt !== 'string' || Number.isNaN(Date.parse(entry.fetchedAt)) || (entry.responseUrl !== undefined && entry.responseUrl !== key) || (entry.sourceUrl !== undefined && entry.sourceUrl !== key)) return undefined
    try { return { data: validate(entry.data), fetchedAt: entry.fetchedAt, catalogVersion: typeof entry.catalogVersion === 'string' ? entry.catalogVersion : undefined } } catch { return undefined }
  }

  private async load<T>(path: string, validate: (raw: unknown) => T, signal?: AbortSignal): Promise<CatalogLoad<T>> {
    const key = catalogUrl(path, this.base)
    const cached = this.cached(await this.cache.get<unknown>(key).catch(() => undefined), key, validate)
    const refresh = async (includeVersion: boolean): Promise<CatalogLoad<T>> => {
      const data = await this.remote(path, validate, signal)
      const catalogVersion = includeVersion ? await this.catalogVersion(signal) : undefined
      const fetchedAt = new Date(this.now()).toISOString()
      await this.cache.set(key, { data, responseUrl: key, catalogVersion, fetchedAt }).catch(() => undefined)
      return { data, source: 'network', fetchedAt, catalogVersion, discardedRecords: discardedRecords(data) }
    }
    if (!cached) return refresh(false)
    const result: CatalogLoad<T> = { data: cached.data, source: 'cached', fetchedAt: cached.fetchedAt, catalogVersion: cached.catalogVersion, discardedRecords: discardedRecords(cached.data) }
    if (this.now() - Date.parse(cached.fetchedAt) >= this.cacheMaxAgeMs) result.refresh = refresh(true)
    return result
  }

  roasteries(signal?: AbortSignal) { return this.load('roasteries/index.json', validateRoasteryIndex, signal) }
  roasteryCoffees(path: string, signal?: AbortSignal) { return this.load(path, validateRoasteryCoffeeIndex, signal) }
  coffee(path: string, signal?: AbortSignal) { return this.load(path, validateCatalogCoffee, signal) }
  recipes(signal?: AbortSignal) { return this.load('recipes/index.json', validateRecipeIndex, signal) }
  recipe(path: string, signal?: AbortSignal) { return this.load(path, validateCatalogRecipe, signal) }
}

export const catalogClient = new CatalogClient()

function normalized(value: string): string { return value.trim().toLocaleLowerCase() }
function ranked<T extends { name: string; sortOrder?: number }>(items: T[], query: string): T[] {
  const needle = normalized(query)
  if (needle.length < 2) return []
  return [...items].filter((item) => normalized(item.name).includes(needle)).sort((left, right) => {
    const leftName = normalized(left.name); const rightName = normalized(right.name)
    const prefixRank = Number(!leftName.startsWith(needle)) - Number(!rightName.startsWith(needle))
    return prefixRank || (left.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.sortOrder ?? Number.MAX_SAFE_INTEGER) || leftName.localeCompare(rightName)
  }).slice(0, 8)
}

export function rankRoasteries(roasteries: CatalogRoasterySummary[], query: string): CatalogRoasterySummary[] { return ranked(roasteries, query) }
export function filterCatalogCoffees(coffees: CatalogCoffeeSummary[], query: string): CatalogCoffeeSummary[] { return ranked(coffees, query) }
export function filterCatalogRecipes(recipes: CatalogRecipeSummary[], query: string, dripper = '', serveStyle = ''): CatalogRecipeSummary[] {
  const needle = normalized(query)
  const filterDripper = normalized(dripper)
  return recipes.filter((recipe) => (!needle || normalized(recipe.name).includes(needle) || normalized(recipe.dripper).includes(needle)) && (!filterDripper || recipe.dripper === dripper) && (!serveStyle || recipe.serveStyle === serveStyle))
}

export function isNewCatalogRecipe(recipe: Pick<CatalogRecipeSummary, 'publishedAt'>, now = Date.now()): boolean {
  const published = Date.parse(recipe.publishedAt)
  return Number.isFinite(published) && published <= now && now - published <= 30 * 24 * 60 * 60 * 1_000
}

export function catalogOrigin(origin: CatalogOrigin | undefined): string | undefined {
  const parts = [origin?.region, origin?.country].filter((part): part is string => Boolean(part))
  const unique = parts.filter((part, index) => parts.findIndex((candidate) => candidate.localeCompare(part, undefined, { sensitivity: 'accent' }) === 0) === index)
  return unique.length ? unique.join(', ') : undefined
}

export function applyCatalogCoffeeToBag(bag: CoffeeBag, coffee: CatalogCoffee, roasteryName: string): CoffeeBag {
  const origin = catalogOrigin(coffee.origin)
  return {
    ...bag, name: coffee.name, roastery: roasteryName,
    ...(origin ? { origin } : {}), ...(coffee.farm ? { farm: coffee.farm } : {}), ...(coffee.altitudeM !== undefined ? { altitudeM: coffee.altitudeM } : {}),
    ...(coffee.processing?.length ? { processing: coffee.processing.slice(0, 3) } : {}), ...(coffee.roastLevel ? { roastLevel: coffee.roastLevel } : {}), ...(coffee.tastingNotes?.length ? { tastingNotes: coffee.tastingNotes.slice(0, 3) } : {}),
  }
}

export function catalogRecipeId(remoteId: string): string {
  const id = `catalog-${catalogId(remoteId, 'recipe ID')}`
  if (id.length > 64) throw new CatalogError('The catalog recipe ID is too long.')
  return id
}

export function catalogRecipeToBrewRecipe(recipe: CatalogRecipe): BrewRecipe {
  const { schemaVersion: _schemaVersion, id, ...catalogValues } = recipe
  const local = normalizeRecipe(migrateRecipe({ ...catalogValues, id: catalogRecipeId(id), starred: false, createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' }))
  const validation = validateRecipe(local)
  if (!validation.valid) throw new CatalogError(Object.values(validation.errors)[0] ?? 'This catalog recipe cannot be saved.')
  return local
}
