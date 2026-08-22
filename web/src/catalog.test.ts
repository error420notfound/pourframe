import { describe, expect, it, vi } from 'vitest'
import {
  applyCatalogCoffeeToBag,
  CatalogClient,
  catalogBaseUrl,
  catalogRecipeId,
  catalogRecipeToBrewRecipe,
  catalogUrl,
  filterCatalogCoffees,
  rankRoasteries,
  safeCatalogPath,
  validateCatalogCoffee,
  validateCatalogRecipe,
  validateRoasteryCoffeeIndex,
  validateRoasteryIndex,
  type CatalogCache,
  type CatalogCacheEntry,
} from './catalog'
import { createCoffeeBag, validateCoffeeBag } from './coffeeBag'

const base = 'https://catalog.example/catalogue'
const version = { schemaVersion: 1, catalogVersion: 'test-1', updatedAt: '2026-08-20' }
const roasteryIndex = { schemaVersion: 1, roasteries: [
  { id: 'north', name: 'Northline Coffee', country: 'India', city: 'Bengaluru', logoUrl: 'https://catalog.example/north.png', path: 'roasteries/north/index.json', sortOrder: 1 },
  { id: 'sun', name: 'Sun North Roasters', path: 'roasteries/sun/index.json', sortOrder: 2 },
  { id: 'other', name: 'Other Roasters', path: 'roasteries/other/index.json', sortOrder: 3 },
] }
const coffeeIndex = { schemaVersion: 1, roastery: { id: 'north', name: 'Northline Coffee', city: 'Bengaluru', country: 'India', active: true }, coffees: [
  { id: 'north-star', name: 'North Star', status: 'available', path: 'roasteries/north/coffees/north-star.json', updatedAt: '2026-08-20', sortOrder: 1 },
  { id: 'late-north', name: 'Late North', status: 'seasonal', path: 'roasteries/north/coffees/late-north.json', updatedAt: '2026-08-20', sortOrder: 2 },
  { id: 'old-north', name: 'Old North', status: 'archived', path: 'roasteries/north/coffees/old-north.json', updatedAt: '2026-08-20', sortOrder: 3 },
  { id: 'sold-north', name: 'Sold North', status: 'sold-out', path: 'roasteries/north/coffees/sold-north.json', updatedAt: '2026-08-20', sortOrder: 4 },
] }
const coffeeDetail = {
  schemaVersion: 1, id: 'north-star', name: 'North Star', roasteryId: 'north', status: 'available', origin: { region: 'Karnataka', country: 'India' }, farm: 'Example Farm', altitudeM: 1450,
  processing: ['Washed'], varieties: ['Caturra'], roastLevel: 'Medium-light', tastingNotes: ['Orange', 'Caramel', 'Cacao'], price: { amount: 750, currency: 'INR' }, bagSizeG: 250,
  productUrl: 'https://catalog.example/products/north-star', imageUrl: 'https://catalog.example/north-star.png', featured: true, sortOrder: 1, description: 'A bright coffee.', source: { url: 'https://catalog.example/source', checkedAt: '2026-08-20' }, updatedAt: '2026-08-20',
}
const recipeDetail = { schemaVersion: 1, id: 'v60-example', name: 'Example V60', dripper: 'V60 02', coffee: 20, water: 320, ratio: 16, grind: 'Medium-fine', bloom: 60, poursAfterBloom: 4, brewTime: 180, flowRate: 4.5, temperature: 94, agitation: 'Gentle swirl', equipment: ['V60 02', 'Filter'], notes: 'Catalog recipe', serveStyle: 'hot' }

class MemoryCache implements CatalogCache {
  values = new Map<string, CatalogCacheEntry<unknown>>()
  async get<T>(key: string) { return this.values.get(key) as CatalogCacheEntry<T> | undefined }
  async set<T>(key: string, value: CatalogCacheEntry<T>) { this.values.set(key, value) }
}

function fetchFrom(values: Record<string, unknown>, contentType = 'application/json') {
  return vi.fn(async (input: string | URL) => {
    const path = String(input)
    if (!(path in values)) return new Response('missing', { status: 404, headers: { 'Content-Type': contentType } })
    return new Response(JSON.stringify(values[path]), { status: 200, headers: { 'Content-Type': contentType } })
  }) as unknown as typeof fetch
}

describe('catalog safety and validation', () => {
  it('normalizes valid base URLs and resolves only safe JSON paths below them', () => {
    expect(catalogBaseUrl('https://catalog.example/catalogue/')).toBe(base)
    expect(catalogUrl('roasteries/north/index.json', base)).toBe(`${base}/roasteries/north/index.json`)
    for (const path of ['../secret.json', '/secret.json', 'https://bad.test/secret.json', 'roasteries\\bad.json', 'recipes/file.txt', 'roasteries/north/index.json?escape=1']) expect(() => safeCatalogPath(path)).toThrow()
    expect(() => catalogBaseUrl('https://user:pass@catalog.example/catalogue')).toThrow()
    expect(() => catalogBaseUrl('https://catalog.example/catalogue?redirect=https://bad.test')).toThrow()
  })

  it('validates current record shapes, statuses, and excludes invalid index records', () => {
    const roasteries = validateRoasteryIndex({ ...roasteryIndex, roasteries: [...roasteryIndex.roasteries, { id: 'not valid!', name: 'Bad', path: '../secret.json' }] })
    expect(roasteries.roasteries).toHaveLength(3); expect(roasteries.discardedRecords).toBe(1)
    expect(validateCatalogCoffee(coffeeDetail).origin?.country).toBe('India')
    expect(validateRoasteryCoffeeIndex(coffeeIndex).coffees.map((coffee) => coffee.status)).toContain('sold-out')
    expect(validateCatalogRecipe(recipeDetail).poursAfterBloom).toBe(4)
    expect(() => validateCatalogCoffee({ ...coffeeDetail, schemaVersion: 2 })).toThrow('unsupported format')
    expect(() => validateCatalogCoffee({ ...coffeeDetail, productUrl: 'javascript:alert(1)' })).toThrow()
    expect(() => validateRoasteryCoffeeIndex({ ...coffeeIndex, coffees: [{ ...coffeeIndex.coffees[0], path: 'roasteries/sun/coffees/north-star.json' }] })).not.toThrow()
  })
})

describe('catalog search and mapping', () => {
  it('ranks prefix matches first, caps results, and retains unavailable coffees', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ id: `north-${index}`, name: `North ${index}`, path: `roasteries/north/index.json`, sortOrder: index }))
    expect(rankRoasteries(validateRoasteryIndex(roasteryIndex).roasteries, 'north').map((item) => item.id)).toEqual(['north', 'sun'])
    expect(rankRoasteries(validateRoasteryIndex(roasteryIndex).roasteries, 'n')).toEqual([])
    expect(rankRoasteries(many, 'north')).toHaveLength(8)
    const coffees = filterCatalogCoffees(validateRoasteryCoffeeIndex(coffeeIndex).coffees, 'north')
    expect(coffees.map((item) => item.id)).toEqual(['north-star', 'late-north', 'old-north', 'sold-north'])
    expect(coffees.map((item) => item.status)).toEqual(['available', 'seasonal', 'archived', 'sold-out'])
  })

  it('applies only explicit profile fields and preserves bag-specific data', () => {
    const bag = { ...createCoffeeBag(), name: 'Manual', roastery: 'Manual Roaster', origin: 'Existing origin', farm: 'Existing farm', altitudeM: 1200, roastedOn: '2026-08-01', originalWeightG: 340, remainingWeightG: 125, beanForm: 'Pre-ground' as const, grind: 'Fine' as const, acidity: 4, bitterness: 1, starred: true }
    const filled = applyCatalogCoffeeToBag(bag, validateCatalogCoffee(coffeeDetail), 'Northline Coffee')
    expect(filled).toMatchObject({ name: 'North Star', roastery: 'Northline Coffee', origin: 'Karnataka, India', farm: 'Example Farm', altitudeM: 1450, roastLevel: 'Medium-light', processing: ['Washed'] })
    expect(filled).toMatchObject({ roastedOn: '2026-08-01', originalWeightG: 340, remainingWeightG: 125, beanForm: 'Pre-ground', grind: 'Fine', acidity: 4, bitterness: 1, starred: true })
    const rangeOnly = validateCatalogCoffee({ ...coffeeDetail, altitudeM: undefined, altitudeRangeM: { min: 1300, max: 1500 } })
    expect(applyCatalogCoffeeToBag(bag, rangeOnly, 'Northline Coffee').altitudeM).toBe(1200)
  })

  it('continues to convert existing catalog recipes deterministically', () => {
    const first = catalogRecipeToBrewRecipe(validateCatalogRecipe(recipeDetail))
    const second = catalogRecipeToBrewRecipe(validateCatalogRecipe({ ...recipeDetail, name: 'Revised V60' }))
    const saved = new Map([[first.id, first]]); saved.set(second.id, second)
    expect(first.id).toBe('catalog-v60-example'); expect(catalogRecipeId('v60-example')).toBe(first.id); expect(saved).toHaveLength(1)
  })
})

describe('catalog loading', () => {
  it('performs the lazy selected-bean sequence without a detail request before selection', async () => {
    const fetcher = fetchFrom({ [`${base}/roasteries/index.json`]: roasteryIndex, [`${base}/roasteries/north/index.json`]: coffeeIndex, [`${base}/roasteries/north/coffees/north-star.json`]: coffeeDetail })
    const client = new CatalogClient({ baseUrl: base, cache: new MemoryCache(), fetch: fetcher })
    await client.roasteries()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await client.roasteryCoffees('roasteries/north/index.json')
    expect(fetcher).toHaveBeenCalledTimes(2)
    await client.coffee('roasteries/north/coffees/north-star.json')
    const paths = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => String(url))
    expect(paths).toEqual([`${base}/roasteries/index.json`, `${base}/roasteries/north/index.json`, `${base}/roasteries/north/coffees/north-star.json`])
  })

  it('returns fresh cache without networking, refreshes stale cache in the background, and checks version once', async () => {
    const cache = new MemoryCache(); const key = catalogUrl('roasteries/index.json', base)
    await cache.set(key, { data: roasteryIndex, responseUrl: key, catalogVersion: 'old', fetchedAt: '2026-08-20T00:00:00.000Z' })
    const fresh = new CatalogClient({ baseUrl: base, cache, fetch: fetchFrom({}), now: () => Date.parse('2026-08-20T12:00:00Z') })
    expect((await fresh.roasteries()).source).toBe('cached')
    const staleFetcher = fetchFrom({ [`${base}/roasteries/index.json`]: roasteryIndex, [`${base}/version.json`]: version })
    const stale = new CatalogClient({ baseUrl: base, cache, fetch: staleFetcher, now: () => Date.parse('2026-08-22T12:00:00Z') })
    const loaded = await stale.roasteries()
    expect(loaded.source).toBe('cached'); await expect(loaded.refresh).resolves.toMatchObject({ source: 'network', catalogVersion: 'test-1' })
    await stale.roasteries()
    expect((staleFetcher as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url) === `${base}/version.json`)).toHaveLength(1)
  })

  it('accepts GitHub Raw plain text only at the raw host and rejects unsupported content types', async () => {
    const rawBase = 'https://raw.githubusercontent.com/error420notfound/pourframe-catalog/main/catalogue'
    await expect(new CatalogClient({ baseUrl: rawBase, cache: new MemoryCache(), fetch: fetchFrom({ [`${rawBase}/roasteries/index.json`]: roasteryIndex }, 'text/plain; charset=utf-8') }).roasteries()).resolves.toMatchObject({ source: 'network' })
    await expect(new CatalogClient({ baseUrl: base, cache: new MemoryCache(), fetch: fetchFrom({ [`${base}/roasteries/index.json`]: roasteryIndex }, 'text/html') }).roasteries()).rejects.toThrow('unsupported response')
  })

  it('times out and propagates caller cancellation', async () => {
    vi.useFakeTimers()
    try {
      const waiting = vi.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')))
      })) as unknown as typeof fetch
      const timed = new CatalogClient({ baseUrl: base, cache: new MemoryCache(), fetch: waiting, timeoutMs: 5 })
      const request = timed.roasteries(); const timedExpectation = expect(request).rejects.toThrow('took too long'); await vi.advanceTimersByTimeAsync(6)
      await timedExpectation
      const controller = new AbortController(); const cancelled = timed.roasteries(controller.signal); const cancellationExpectation = expect(cancelled).rejects.toThrow(); controller.abort()
      await cancellationExpectation
    } finally { vi.useRealTimers() }
  })

  it('uses valid cache during failure and leaves manual bag validation available without cache', async () => {
    const cache = new MemoryCache(); const key = catalogUrl('roasteries/index.json', base)
    await cache.set(key, { data: roasteryIndex, responseUrl: key, fetchedAt: '2026-08-20T00:00:00.000Z' })
    const cached = new CatalogClient({ baseUrl: base, cache, fetch: fetchFrom({}), now: () => Date.parse('2026-08-20T12:00:00Z') })
    expect((await cached.roasteries()).data.roasteries).toHaveLength(3)
    const unavailable = new CatalogClient({ baseUrl: base, cache: new MemoryCache(), fetch: fetchFrom({}) })
    await expect(unavailable.roasteries()).rejects.toThrow('unavailable')
    expect(validateCoffeeBag({ ...createCoffeeBag(), name: 'Manual coffee', roastery: 'Manual roastery' }).valid).toBe(true)
  })
})
