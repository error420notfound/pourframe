import { describe, expect, it, vi } from 'vitest'
import { applyCatalogCoffeeToBag, CatalogClient, catalogRecipeId, catalogRecipeToBrewRecipe, catalogUrl, filterCatalogCoffees, isNewCatalogRecipe, rankRoasteries, safeCatalogPath, type CatalogCache, type CatalogCacheEntry, validateCatalogCoffee, validateCatalogRecipe, validateRoasteryCoffeeIndex, validateRoasteryIndex } from './catalog'
import { createCoffeeBag, validateCoffeeBag } from './coffeeBag'

const base = 'https://catalog.example/catalogue'
const version = { schemaVersion: 1, catalogVersion: 'test-1', updatedAt: '2026-08-20' }
const roasteryIndex = { schemaVersion: 1, roasteries: [
  { id: 'north', name: 'Northline Coffee', path: 'roasteries/north/index.json' },
  { id: 'sun', name: 'Sun North Roasters', path: 'roasteries/sun/index.json' },
  { id: 'other', name: 'Other Roasters', path: 'roasteries/other/index.json' },
] }
const coffeeIndex = { schemaVersion: 1, roastery: { id: 'north', name: 'Northline Coffee' }, coffees: [
  { id: 'north-star', name: 'North Star', status: 'available', path: 'roasteries/north/coffees/north-star.json', updatedAt: '2026-08-20' },
  { id: 'late-north', name: 'Late North', status: 'seasonal', path: 'roasteries/north/coffees/late-north.json', updatedAt: '2026-08-20' },
] }
const coffeeDetail = { schemaVersion: 1, id: 'north-star', name: 'North Star', roasteryId: 'north', status: 'available', origin: { region: 'Karnataka', country: 'India' }, farm: 'Example Farm', altitudeM: 1450, processing: ['Washed'], roastLevel: 'Medium-light', tastingNotes: ['Orange', 'Caramel', 'Cacao'] }
const recipeDetail = { schemaVersion: 1, id: 'v60-example', name: 'Example V60', dripper: 'V60 02', coffee: 20, water: 320, ratio: 16, grind: 'Medium-fine', bloom: 60, poursAfterBloom: 4, brewTime: 180, flowRate: 4.5, temperature: 94, agitation: 'Gentle swirl', equipment: ['V60 02', 'Filter'], notes: 'Catalog recipe', serveStyle: 'hot' }

class MemoryCache implements CatalogCache {
  values = new Map<string, CatalogCacheEntry<unknown>>()
  async get<T>(key: string) { return this.values.get(key) as CatalogCacheEntry<T> | undefined }
  async set<T>(key: string, value: CatalogCacheEntry<T>) { this.values.set(key, value) }
}

function fetchFrom(values: Record<string, unknown>) {
  return vi.fn(async (input: string | URL) => {
    const path = String(input)
    if (!(path in values)) return new Response('missing', { status: 404 })
    return new Response(JSON.stringify(values[path]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

describe('catalog safety and validation', () => {
  it('constructs URLs beneath the configured base and rejects unsafe paths', () => {
    expect(catalogUrl('roasteries/north/index.json', base)).toBe(`${base}/roasteries/north/index.json`)
    for (const path of ['../secret.json', '/secret.json', 'https://bad.test/secret.json', 'roasteries\\bad.json', 'recipes/file.txt']) expect(() => safeCatalogPath(path)).toThrow()
  })

  it('validates the supported runtime shapes and rejects malformed records', () => {
    expect(validateRoasteryIndex(roasteryIndex).roasteries).toHaveLength(3)
    expect(validateCatalogCoffee(coffeeDetail).origin.country).toBe('India')
    expect(validateCatalogRecipe(recipeDetail).poursAfterBloom).toBe(4)
    expect(() => validateCatalogCoffee({ ...coffeeDetail, schemaVersion: 2 })).toThrow('unsupported format')
    expect(() => validateCatalogRecipe({ ...recipeDetail, water: 1500 })).toThrow()
  })
})

describe('catalog search and mapping', () => {
  it('ranks prefix roastery matches before substring matches and caps results', () => {
    expect(rankRoasteries(validateRoasteryIndex(roasteryIndex).roasteries, 'north').map((item) => item.id)).toEqual(['north', 'sun'])
    expect(rankRoasteries(validateRoasteryIndex(roasteryIndex).roasteries, 'n')).toEqual([])
    expect(filterCatalogCoffees(validateRoasteryCoffeeIndex(coffeeIndex).coffees, 'north').map((item) => item.id)).toEqual(['north-star', 'late-north'])
  })

  it('applies only profile data from a catalog coffee and preserves bag-specific fields', () => {
    const bag = { ...createCoffeeBag(), roastedOn: '2026-08-01', originalWeightG: 340, remainingWeightG: 125, beanForm: 'Pre-ground' as const, grind: 'Fine' as const, acidity: 4, bitterness: 1, starred: true }
    const filled = applyCatalogCoffeeToBag(bag, validateCatalogCoffee(coffeeDetail), 'Northline Coffee')
    expect(filled).toMatchObject({ name: 'North Star', roastery: 'Northline Coffee', origin: 'Karnataka, India', farm: 'Example Farm', altitudeM: 1450, roastLevel: 'Medium-light', processing: ['Washed'] })
    expect(filled).toMatchObject({ roastedOn: '2026-08-01', originalWeightG: 340, remainingWeightG: 125, beanForm: 'Pre-ground', grind: 'Fine', acidity: 4, bitterness: 1, starred: true })
  })

  it('converts catalog recipes to deterministic valid local records and updates by the same ID', () => {
    const first = catalogRecipeToBrewRecipe(validateCatalogRecipe(recipeDetail))
    const second = catalogRecipeToBrewRecipe(validateCatalogRecipe({ ...recipeDetail, name: 'Revised V60' }))
    const saved = new Map([[first.id, first]]); saved.set(second.id, second)
    expect(first.id).toBe('catalog-v60-example'); expect(first.id.length).toBeLessThanOrEqual(64)
    expect(catalogRecipeId('v60-example')).toBe(first.id); expect(saved).toHaveLength(1); expect(saved.get(first.id)?.name).toBe('Revised V60'); expect(first.starred).toBe(false)
  })

  it('identifies recipes published in the previous 30 days', () => {
    const now = Date.parse('2026-08-20T00:00:00Z')
    expect(isNewCatalogRecipe({ publishedAt: '2026-07-22' } as never, now)).toBe(true)
    expect(isNewCatalogRecipe({ publishedAt: '2026-07-20' } as never, now)).toBe(false)
  })
})

describe('catalog loading', () => {
  it('performs only the selected bean fetch sequence', async () => {
    const fetcher = fetchFrom({ [`${base}/roasteries/index.json`]: roasteryIndex, [`${base}/roasteries/north/index.json`]: coffeeIndex, [`${base}/roasteries/north/coffees/north-star.json`]: coffeeDetail, [`${base}/version.json`]: version })
    const client = new CatalogClient({ baseUrl: base, cache: new MemoryCache(), fetch: fetcher })
    await client.roasteries(); await client.roasteryCoffees('roasteries/north/index.json'); await client.coffee('roasteries/north/coffees/north-star.json')
    const paths = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url))
    expect(paths).toContain(`${base}/roasteries/index.json`); expect(paths).toContain(`${base}/roasteries/north/index.json`); expect(paths).toContain(`${base}/roasteries/north/coffees/north-star.json`)
    expect(paths).not.toContain(`${base}/roasteries/sun/index.json`)
  })

  it('returns cached data immediately, refreshes in the background, and survives refresh failure', async () => {
    const cache = new MemoryCache(); const key = catalogUrl('roasteries/index.json', base)
    await cache.set(key, { data: validateRoasteryIndex(roasteryIndex), sourceUrl: key, catalogVersion: 'old', fetchedAt: '2026-08-01T00:00:00.000Z' })
    const client = new CatalogClient({ baseUrl: base, cache, fetch: fetchFrom({}) })
    const loaded = await client.roasteries()
    expect(loaded.source).toBe('cached'); expect(loaded.data.roasteries[0].id).toBe('north')
    await expect(loaded.refresh).rejects.toThrow('unavailable')
  })

  it('reports an unavailable catalog without a cache and supports cancellation', async () => {
    const unavailable = new CatalogClient({ baseUrl: base, cache: new MemoryCache(), fetch: fetchFrom({}) })
    await expect(unavailable.roasteries()).rejects.toThrow('unavailable')
    expect(validateCoffeeBag({ ...createCoffeeBag(), name: 'Manual coffee', roastery: 'Manual roastery' }).valid).toBe(true)
    const waiting = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { if (init?.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }; init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) })) as unknown as typeof fetch
    const client = new CatalogClient({ baseUrl: base, cache: new MemoryCache(), fetch: waiting, timeoutMs: 10_000 })
    const controller = new AbortController(); const request = client.roasteries(controller.signal); controller.abort()
    await expect(request).rejects.toThrow(); expect(waiting).toHaveBeenCalledOnce()
  })
})
