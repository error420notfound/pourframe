import { migrateRecipe, normalizeRecipe, validateRecipe } from './brew'
import type { BrewRecipe, CoffeeBag, GrindSize, RoastLevel } from './brewTypes'

export const DEFAULT_CATALOG_BASE_URL = 'https://raw.githubusercontent.com/error420notfound/pourframe-catalog/main/catalogue'
export const CATALOG_REPOSITORY_URL = 'https://github.com/error420notfound/pourframe-catalog'
export const CATALOG_TIMEOUT_MS = 5_000

const roastLevels: RoastLevel[] = ['Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark']
const grindSizes: GrindSize[] = ['Fine', 'Medium-fine', 'Medium', 'Medium-coarse', 'Coarse']
const serveStyles = ['hot', 'iced'] as const
const coffeeStatuses = ['available', 'seasonal', 'archived', 'unknown'] as const
const idPattern = /^[a-z0-9][a-z0-9-]{0,47}$/

export interface CatalogVersion { schemaVersion: 1; catalogVersion: string; updatedAt: string }
export interface CatalogRoasterySummary { id: string; name: string; path: string }
export interface CatalogRoasteryIndex { schemaVersion: 1; roasteries: CatalogRoasterySummary[] }
export interface CatalogCoffeeSummary { id: string; name: string; status: typeof coffeeStatuses[number]; path: string; updatedAt: string }
export interface CatalogRoasteryCoffeeIndex { schemaVersion: 1; roastery: { id: string; name: string }; coffees: CatalogCoffeeSummary[] }
export interface CatalogCoffee {
  schemaVersion: 1; id: string; name: string; roasteryId: string; status: typeof coffeeStatuses[number]
  origin: { country?: string; region?: string }; farm?: string; altitudeM?: number; processing: string[]; roastLevel: RoastLevel; tastingNotes: string[]
}
export interface CatalogRecipeSummary { id: string; name: string; dripper: string; serveStyle: 'hot' | 'iced'; path: string; publishedAt: string; updatedAt: string }
export interface CatalogRecipeIndex { schemaVersion: 1; recipes: CatalogRecipeSummary[] }
export interface CatalogRecipe {
  schemaVersion: 1; id: string; name: string; dripper: string; coffee: number; water: number; ratio: number; grind: GrindSize; bloom: number
  poursAfterBloom: number; brewTime: number; flowRate: number; temperature: number; agitation: string; equipment: string[]; notes: string; serveStyle: 'hot' | 'iced'
}

export interface CatalogCacheEntry<T> { data: T; sourceUrl: string; catalogVersion: string; fetchedAt: string }
export interface CatalogCache { get<T>(key: string): Promise<CatalogCacheEntry<T> | undefined>; set<T>(key: string, value: CatalogCacheEntry<T>): Promise<void> }
export interface CatalogDependencies { fetch?: typeof fetch; cache?: CatalogCache; baseUrl?: string; timeoutMs?: number }
export interface CatalogLoad<T> { data: T; source: 'network' | 'cached'; fetchedAt: string; refresh?: Promise<CatalogLoad<T>> }

export class CatalogError extends Error {}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function string(value: unknown, maximum: number, name: string, required = true): string {
  if (value === undefined && !required) return undefined as never
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new CatalogError(`The catalog ${name} is invalid.`)
  return value
}

function number(value: unknown, minimum: number, maximum: number, name: string, integer = false, required = true): number {
  if (value === undefined && !required) return undefined as never
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) throw new CatalogError(`The catalog ${name} is invalid.`)
  return value
}

function array(value: unknown, maximum: number, name: string) {
  if (!Array.isArray(value) || value.length > maximum) throw new CatalogError(`The catalog ${name} is invalid.`)
  return value
}

function schema(value: Record<string, unknown>) {
  if (value.schemaVersion !== 1) throw new CatalogError('This catalog uses an unsupported format.')
}

function catalogId(value: unknown, name: string) {
  const id = string(value, 48, name)
  if (!idPattern.test(id)) throw new CatalogError(`The catalog ${name} is invalid.`)
  return id
}

export function safeCatalogPath(value: unknown) {
  const path = string(value, 200, 'path')
  if (!path.endsWith('.json') || path.startsWith('/') || path.includes('..') || path.includes('\\') || /[:?#]/.test(path)) throw new CatalogError('The catalog referenced an unsafe file path.')
  return path
}

export function catalogBaseUrl(configured = import.meta.env.VITE_CATALOG_BASE_URL): string {
  const raw = configured?.trim() || DEFAULT_CATALOG_BASE_URL
  let url: URL
  try { url = new URL(raw) } catch { throw new CatalogError('The catalog address is invalid.') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CatalogError('The catalog address is invalid.')
  url.hash = ''; url.search = ''
  return url.href.replace(/\/+$/, '')
}

export function catalogUrl(path: string, base = catalogBaseUrl()) {
  const safePath = safeCatalogPath(path)
  const root = `${catalogBaseUrl(base)}/`
  const url = new URL(safePath, root)
  if (!url.href.startsWith(root)) throw new CatalogError('The catalog referenced an unsafe file path.')
  return url.href
}

function parseRoasterySummary(value: unknown): CatalogRoasterySummary {
  const item = record(value); if (!item) throw new CatalogError('The catalog roastery index is invalid.')
  return { id: catalogId(item.id, 'roastery ID'), name: string(item.name, 80, 'roastery name'), path: safeCatalogPath(item.path) }
}

function parseCoffeeSummary(value: unknown): CatalogCoffeeSummary {
  const item = record(value); if (!item) throw new CatalogError('The catalog coffee index is invalid.')
  const status = string(item.status, 20, 'coffee status')
  if (!coffeeStatuses.includes(status as typeof coffeeStatuses[number])) throw new CatalogError('The catalog coffee status is invalid.')
  return { id: catalogId(item.id, 'coffee ID'), name: string(item.name, 80, 'coffee name'), status: status as CatalogCoffeeSummary['status'], path: safeCatalogPath(item.path), updatedAt: string(item.updatedAt, 32, 'coffee update date') }
}

function parseRecipeSummary(value: unknown): CatalogRecipeSummary {
  const item = record(value); if (!item) throw new CatalogError('The catalog recipe index is invalid.')
  const serveStyle = string(item.serveStyle, 10, 'recipe serving style')
  if (!serveStyles.includes(serveStyle as 'hot' | 'iced')) throw new CatalogError('The catalog recipe serving style is invalid.')
  return { id: catalogId(item.id, 'recipe ID'), name: string(item.name, 80, 'recipe name'), dripper: string(item.dripper, 80, 'recipe dripper'), serveStyle: serveStyle as 'hot' | 'iced', path: safeCatalogPath(item.path), publishedAt: string(item.publishedAt, 32, 'recipe publication date'), updatedAt: string(item.updatedAt, 32, 'recipe update date') }
}

export function validateCatalogVersion(raw: unknown): CatalogVersion {
  const item = record(raw); if (!item) throw new CatalogError('The catalog version is invalid.'); schema(item)
  return { schemaVersion: 1, catalogVersion: string(item.catalogVersion, 40, 'version'), updatedAt: string(item.updatedAt, 32, 'update date') }
}

export function validateRoasteryIndex(raw: unknown): CatalogRoasteryIndex {
  const item = record(raw); if (!item) throw new CatalogError('The catalog roastery index is invalid.'); schema(item)
  return { schemaVersion: 1, roasteries: array(item.roasteries, 500, 'roasteries').map(parseRoasterySummary) }
}

export function validateRoasteryCoffeeIndex(raw: unknown): CatalogRoasteryCoffeeIndex {
  const item = record(raw); if (!item) throw new CatalogError('The catalog coffee index is invalid.'); schema(item)
  const roastery = record(item.roastery); if (!roastery) throw new CatalogError('The catalog coffee index is invalid.')
  return { schemaVersion: 1, roastery: { id: catalogId(roastery.id, 'roastery ID'), name: string(roastery.name, 80, 'roastery name') }, coffees: array(item.coffees, 500, 'coffees').map(parseCoffeeSummary) }
}

export function validateCatalogCoffee(raw: unknown): CatalogCoffee {
  const item = record(raw); if (!item) throw new CatalogError('The catalog coffee is invalid.'); schema(item)
  const origin = record(item.origin); if (!origin) throw new CatalogError('The catalog coffee origin is invalid.')
  const roastLevel = string(item.roastLevel, 20, 'coffee roast level')
  if (!roastLevels.includes(roastLevel as RoastLevel)) throw new CatalogError('The catalog coffee roast level is invalid.')
  const status = string(item.status, 20, 'coffee status')
  if (!coffeeStatuses.includes(status as CatalogCoffee['status'])) throw new CatalogError('The catalog coffee status is invalid.')
  const country = string(origin.country, 80, 'coffee country', false)
  const region = string(origin.region, 80, 'coffee region', false)
  if (!country && !region) throw new CatalogError('The catalog coffee origin is invalid.')
  return {
    schemaVersion: 1, id: catalogId(item.id, 'coffee ID'), name: string(item.name, 80, 'coffee name'), roasteryId: catalogId(item.roasteryId, 'roastery ID'), status: status as CatalogCoffee['status'], origin: { country, region },
    farm: string(item.farm, 80, 'coffee farm', false), altitudeM: number(item.altitudeM, 0, 5000, 'coffee altitude', true, false), processing: array(item.processing, 3, 'coffee processing').map((part) => string(part, 40, 'coffee processing')),
    roastLevel: roastLevel as RoastLevel, tastingNotes: array(item.tastingNotes, 3, 'coffee tasting notes').map((part) => string(part, 40, 'coffee tasting note')),
  }
}

export function validateRecipeIndex(raw: unknown): CatalogRecipeIndex {
  const item = record(raw); if (!item) throw new CatalogError('The catalog recipe index is invalid.'); schema(item)
  return { schemaVersion: 1, recipes: array(item.recipes, 500, 'recipes').map(parseRecipeSummary) }
}

export function validateCatalogRecipe(raw: unknown): CatalogRecipe {
  const item = record(raw); if (!item) throw new CatalogError('The catalog recipe is invalid.'); schema(item)
  const grind = string(item.grind, 20, 'recipe grind')
  const serveStyle = string(item.serveStyle, 10, 'recipe serving style')
  if (!grindSizes.includes(grind as GrindSize) || !serveStyles.includes(serveStyle as 'hot' | 'iced')) throw new CatalogError('The catalog recipe is invalid.')
  return {
    schemaVersion: 1, id: catalogId(item.id, 'recipe ID'), name: string(item.name, 80, 'recipe name'), dripper: string(item.dripper, 80, 'recipe dripper'), coffee: number(item.coffee, .1, 80, 'recipe coffee'), water: number(item.water, .1, 1200, 'recipe water'), ratio: number(item.ratio, .1, 30, 'recipe ratio'), grind: grind as GrindSize,
    bloom: number(item.bloom, .1, 1200, 'recipe bloom'), poursAfterBloom: number(item.poursAfterBloom, 1, 6, 'recipe pours', true), brewTime: number(item.brewTime, 90, 420, 'recipe brew time', true), flowRate: number(item.flowRate, 1, 8, 'recipe flow rate'), temperature: number(item.temperature, 80, 100, 'recipe temperature', true), agitation: string(item.agitation, 200, 'recipe agitation'), equipment: array(item.equipment, 12, 'recipe equipment').map((part) => string(part, 80, 'recipe equipment')), notes: string(item.notes, 500, 'recipe notes'), serveStyle: serveStyle as 'hot' | 'iced',
  }
}

class IndexedDbCatalogCache implements CatalogCache {
  private open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pourframe-catalog-v1', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('responses')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  async get<T>(key: string) {
    const database = await this.open()
    return new Promise<CatalogCacheEntry<T> | undefined>((resolve, reject) => {
      const request = database.transaction('responses').objectStore('responses').get(key)
      request.onsuccess = () => resolve(request.result as CatalogCacheEntry<T> | undefined)
      request.onerror = () => reject(request.error)
    }).finally(() => database.close())
  }
  async set<T>(key: string, value: CatalogCacheEntry<T>) {
    const database = await this.open()
    return new Promise<void>((resolve, reject) => {
      const request = database.transaction('responses', 'readwrite').objectStore('responses').put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    }).finally(() => database.close())
  }
}

function browserCache(): CatalogCache {
  if (typeof indexedDB === 'undefined') return { get: async () => undefined, set: async () => undefined }
  return new IndexedDbCatalogCache()
}

async function readJson(fetcher: typeof fetch, url: string, signal: AbortSignal) {
  const response = await fetcher(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new CatalogError('The PourFrame Catalog is unavailable right now.')
  try { return await response.json() as unknown } catch { throw new CatalogError('The catalog returned invalid data.') }
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(new CatalogError('The catalog request took too long.')), timeoutMs)
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true })
  return { signal: controller.signal, dispose: () => { globalThis.clearTimeout(timeout); signal?.removeEventListener('abort', abort) } }
}

export class CatalogClient {
  private readonly fetcher: typeof fetch
  private readonly cache: CatalogCache
  private readonly base: string
  private readonly timeoutMs: number
  constructor(dependencies: CatalogDependencies = {}) {
    this.fetcher = dependencies.fetch ?? fetch
    this.cache = dependencies.cache ?? browserCache()
    this.base = catalogBaseUrl(dependencies.baseUrl)
    this.timeoutMs = dependencies.timeoutMs ?? CATALOG_TIMEOUT_MS
  }

  private async remote<T>(path: string, validate: (raw: unknown) => T, signal?: AbortSignal) {
    const timed = timeoutSignal(signal, this.timeoutMs)
    try { return await readJson(this.fetcher, catalogUrl(path, this.base), timed.signal).then(validate) } finally { timed.dispose() }
  }

  private async load<T>(path: string, validate: (raw: unknown) => T, signal?: AbortSignal): Promise<CatalogLoad<T>> {
    const key = catalogUrl(path, this.base)
    const cached = await this.cache.get<T>(key).catch(() => undefined)
    const refresh = async (): Promise<CatalogLoad<T>> => {
      const data = await this.remote(path, validate, signal)
      let catalogVersion = cached?.catalogVersion ?? 'unknown'
      try { catalogVersion = (await this.remote('version.json', validateCatalogVersion, signal)).catalogVersion } catch { /* the validated record remains useful */ }
      const fetchedAt = new Date().toISOString()
      await this.cache.set(key, { data, sourceUrl: key, catalogVersion, fetchedAt }).catch(() => undefined)
      return { data, source: 'network', fetchedAt }
    }
    if (cached) return { data: cached.data, source: 'cached', fetchedAt: cached.fetchedAt, refresh: refresh() }
    return refresh()
  }

  roasteries(signal?: AbortSignal) { return this.load('roasteries/index.json', validateRoasteryIndex, signal) }
  roasteryCoffees(path: string, signal?: AbortSignal) { return this.load(path, validateRoasteryCoffeeIndex, signal) }
  coffee(path: string, signal?: AbortSignal) { return this.load(path, validateCatalogCoffee, signal) }
  recipes(signal?: AbortSignal) { return this.load('recipes/index.json', validateRecipeIndex, signal) }
  recipe(path: string, signal?: AbortSignal) { return this.load(path, validateCatalogRecipe, signal) }
}

export const catalogClient = new CatalogClient()

function normalized(value: string) { return value.trim().toLocaleLowerCase() }
function ranked<T extends { name: string }>(items: T[], query: string) {
  const needle = normalized(query)
  if (needle.length < 2) return []
  return items.filter((item) => normalized(item.name).includes(needle)).sort((left, right) => {
    const leftName = normalized(left.name); const rightName = normalized(right.name)
    const rank = Number(!leftName.startsWith(needle)) - Number(!rightName.startsWith(needle))
    return rank || leftName.localeCompare(rightName)
  }).slice(0, 8)
}

export function rankRoasteries(roasteries: CatalogRoasterySummary[], query: string) { return ranked(roasteries, query) }
export function filterCatalogCoffees(coffees: CatalogCoffeeSummary[], query: string) { return ranked(coffees, query) }
export function filterCatalogRecipes(recipes: CatalogRecipeSummary[], query: string, dripper = '', serveStyle = '') {
  const needle = normalized(query)
  const filterDripper = normalized(dripper)
  return recipes.filter((recipe) => (!needle || normalized(recipe.name).includes(needle) || normalized(recipe.dripper).includes(needle)) && (!filterDripper || recipe.dripper === dripper) && (!serveStyle || recipe.serveStyle === serveStyle))
}

export function isNewCatalogRecipe(recipe: Pick<CatalogRecipeSummary, 'publishedAt'>, now = Date.now()) {
  const published = Date.parse(recipe.publishedAt)
  return Number.isFinite(published) && published <= now && now - published <= 30 * 24 * 60 * 60 * 1000
}

export function applyCatalogCoffeeToBag(bag: CoffeeBag, coffee: CatalogCoffee, roasteryName: string): CoffeeBag {
  const origin = [coffee.origin.region, coffee.origin.country].filter((part): part is string => Boolean(part)).join(', ')
  return { ...bag, name: coffee.name, roastery: roasteryName, origin, farm: coffee.farm ?? '', altitudeM: coffee.altitudeM, processing: coffee.processing, roastLevel: coffee.roastLevel, tastingNotes: [...coffee.tastingNotes] }
}

export function catalogRecipeId(remoteId: string) {
  const id = `catalog-${catalogId(remoteId, 'recipe ID')}`
  if (id.length > 64) throw new CatalogError('The catalog recipe ID is too long.')
  return id
}

export function catalogRecipeToBrewRecipe(recipe: CatalogRecipe): BrewRecipe {
  const { schemaVersion: _schemaVersion, id, ...catalogValues } = recipe
  const local = normalizeRecipe(migrateRecipe({ ...catalogValues, id: catalogRecipeId(id), starred: false }))
  const validation = validateRecipe(local)
  if (!validation.valid) throw new CatalogError(Object.values(validation.errors)[0] ?? 'This catalog recipe cannot be saved.')
  return local
}
