// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoffeeCatalogFields } from './CoffeeCatalogFields'
import { catalogClient, CatalogClient, type CatalogCache, type CatalogCacheEntry } from './catalog'
import { createCoffeeBag } from './coffeeBag'
import type { CoffeeBag } from './brewTypes'
import { CoffeeBagWorkspace } from './CoffeeBagWorkspace'

const base = 'https://catalog.example/catalogue'
const roasteries = { schemaVersion: 1, roasteries: [{ id: 'north', name: 'Northline Coffee', city: 'Bengaluru', country: 'India', logoUrl: 'https://catalog.example/broken-logo.png', path: 'roasteries/north/index.json' }] }
const coffees = { schemaVersion: 1, roastery: { id: 'north', name: 'Northline Coffee', city: 'Bengaluru', country: 'India' }, coffees: [
  { id: 'north-star', name: 'North Star', status: 'available', path: 'roasteries/north/coffees/north-star.json', updatedAt: '2026-08-20', sortOrder: 1 },
  { id: 'north-seasonal', name: 'North Seasonal', status: 'seasonal', path: 'roasteries/north/coffees/north-seasonal.json', updatedAt: '2026-08-20', sortOrder: 2 },
  { id: 'north-old', name: 'North Old', status: 'archived', path: 'roasteries/north/coffees/north-old.json', updatedAt: '2026-08-20', sortOrder: 3 },
  { id: 'north-sold', name: 'North Sold', status: 'sold-out', path: 'roasteries/north/coffees/north-sold.json', updatedAt: '2026-08-20', sortOrder: 4 },
] }
const coffee = { schemaVersion: 1, id: 'north-star', name: 'North Star', roasteryId: 'north', status: 'available', origin: { region: 'Karnataka', country: 'India' }, farm: 'Catalog Farm', altitudeRangeM: { min: 1200, max: 1400 }, processing: ['Washed'], varieties: ['Caturra'], roastLevel: 'Medium-light', tastingNotes: ['Orange', 'Caramel'], bagSizeG: 250, imageUrl: 'https://catalog.example/broken-coffee.png', productUrl: 'https://catalog.example/product', source: { url: 'https://catalog.example/source', checkedAt: '2026-08-20' }, updatedAt: '2026-08-20' }

class MemoryCache implements CatalogCache {
  values = new Map<string, CatalogCacheEntry<unknown>>()
  async get<T>(key: string) { return this.values.get(key) as CatalogCacheEntry<T> | undefined }
  async set<T>(key: string, value: CatalogCacheEntry<T>) { this.values.set(key, value) }
}

function client(values: Record<string, unknown>) {
  const fetcher = vi.fn(async (url: string | URL) => {
    const value = values[String(url)]
    return value ? new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }) : new Response('missing', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  return { client: new CatalogClient({ baseUrl: base, cache: new MemoryCache(), fetch: fetcher }), fetcher }
}

function Harness({ client: catalog }: { client: CatalogClient }) {
  const [draft, setDraft] = useState<CoffeeBag>({ ...createCoffeeBag(), name: 'Manual coffee', roastery: '', origin: 'Existing origin', farm: 'Existing farm', altitudeM: 1111, originalWeightG: 340, remainingWeightG: 125 })
  return <><CoffeeCatalogFields client={catalog} draft={draft} setDraft={(value) => setDraft((current) => typeof value === 'function' ? value(current) : value)} /><output aria-label="Draft state">{JSON.stringify(draft)}</output></>
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function selectCatalogCoffee(user: ReturnType<typeof userEvent.setup>) {
  const roastery = screen.getByRole('combobox', { name: 'Roastery' })
  await user.type(roastery, 'No')
  await screen.findByRole('option', { name: /Northline Coffee/i })
  await user.keyboard('{ArrowDown}{Enter}')
  const coffeeInput = screen.getByRole('combobox', { name: 'Coffee / roast name' })
  await user.clear(coffeeInput); await user.type(coffeeInput, 'North')
  await screen.findByRole('option', { name: /North Star/i })
  await user.keyboard('{ArrowDown}{Enter}')
  await screen.findByRole('heading', { name: 'North Star' })
}

describe('CoffeeCatalogFields', () => {
  it('supports keyboard selection, visible unavailable statuses, and safe image fallbacks', async () => {
    const user = userEvent.setup()
    const { client: catalog } = client({ [`${base}/roasteries/index.json`]: roasteries, [`${base}/roasteries/north/index.json`]: coffees, [`${base}/roasteries/north/coffees/north-star.json`]: coffee })
    const { container } = render(<Harness client={catalog} />)
    const roastery = screen.getByRole('combobox', { name: 'Roastery' })
    await user.type(roastery, 'No')
    await screen.findByRole('option', { name: /Northline Coffee/i })
    const logo = container.querySelector('img.catalog-option__logo')
    expect(logo).not.toBeNull(); fireEvent.error(logo!)
    expect(container.querySelector('.catalog-option__logo--fallback')).not.toBeNull()
    await user.keyboard('{ArrowDown}{Enter}')
    const coffeeInput = screen.getByRole('combobox', { name: 'Coffee / roast name' })
    await user.clear(coffeeInput); await user.type(coffeeInput, 'North')
    await screen.findByText('seasonal'); expect(screen.getByText('archived')).not.toBeNull(); expect(screen.getByText('sold out')).not.toBeNull()
    await user.keyboard('{ArrowDown}{Enter}')
    await screen.findByRole('heading', { name: 'North Star' })
    const image = container.querySelector('img.catalog-preview__image')
    expect(image).not.toBeNull(); fireEvent.error(image!)
    expect(container.querySelector('.catalog-preview__image--fallback')).not.toBeNull()
  })

  it('does not apply catalog profile values until explicitly requested, never invents altitude, and requires bag-size action', async () => {
    const user = userEvent.setup()
    const { client: catalog } = client({ [`${base}/roasteries/index.json`]: roasteries, [`${base}/roasteries/north/index.json`]: coffees, [`${base}/roasteries/north/coffees/north-star.json`]: coffee })
    render(<Harness client={catalog} />)
    await selectCatalogCoffee(user)
    expect(screen.getByLabelText('Draft state').textContent).toContain('Existing origin')
    await user.click(screen.getByRole('button', { name: 'Fill bag details' }))
    await waitFor(() => expect(screen.getByLabelText('Draft state').textContent).toContain('Karnataka, India'))
    expect(screen.getByLabelText('Draft state').textContent).toContain('"altitudeM":1111')
    expect(screen.getByLabelText('Draft state').textContent).toContain('"originalWeightG":340')
    expect(screen.getByLabelText('Draft state').textContent).toContain('"remainingWeightG":125')
    await user.click(screen.getByRole('button', { name: 'Use 250 g as original weight' }))
    await waitFor(() => expect(screen.getByLabelText('Draft state').textContent).toContain('"originalWeightG":250'))
    expect(screen.getByLabelText('Draft state').textContent).toContain('"remainingWeightG":125')
  })

  it('clears old catalog suggestions when the selected roastery text changes and keeps manual entry available offline', async () => {
    const user = userEvent.setup()
    const unavailable = client({})
    render(<Harness client={unavailable.client} />)
    await screen.findByText('Catalog is unavailable — you can still enter this bag manually.')
    const roastery = screen.getByRole('combobox', { name: 'Roastery' })
    await user.type(roastery, 'Manual Roaster')
    const coffeeInput = screen.getByRole('combobox', { name: 'Coffee / roast name' })
    await user.clear(coffeeInput); await user.type(coffeeInput, 'Manual coffee')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByLabelText('Draft state').textContent).toContain('Manual Roaster')
  })

  it('keeps the existing manual bag save path available when the catalog is unavailable', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }) })
    vi.spyOn(catalogClient, 'roasteries').mockRejectedValue(new Error('offline'))
    const onSave = vi.fn(async (_bag: CoffeeBag) => undefined)
    const user = userEvent.setup()
    render(<CoffeeBagWorkspace bags={[]} onDelete={async () => undefined} onSave={onSave} onUse={() => undefined} />)
    await user.click(screen.getByRole('button', { name: /Add bag/i }))
    await screen.findByRole('button', { name: 'Save coffee bag' })
    const roastery = screen.getByRole('combobox', { name: 'Roastery' })
    const coffeeInput = screen.getByRole('combobox', { name: 'Coffee / roast name' })
    await user.type(roastery, 'Manual Roaster')
    await user.clear(coffeeInput); await user.type(coffeeInput, 'Manual Coffee')
    await user.click(screen.getByRole('button', { name: 'Save coffee bag' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce())
    const saved = onSave.mock.calls[0][0]
    expect(saved).toMatchObject({ name: 'Manual Coffee', roastery: 'Manual Roaster' })
    expect(saved).not.toHaveProperty('catalog')
  })
})
