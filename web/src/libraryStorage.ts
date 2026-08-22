import type { BrewRecipe, BrewRecord, CoffeeBag, Collection } from './brewTypes'
import { migrateRecipe, validateRecipe } from './brew'
import { normalizeCoffeeBag, validateCoffeeBag } from './coffeeBag'

const databaseName = 'pourframe-ui-v1'
const databaseVersion = 2
const cacheStore = 'cache'
const outboxStore = 'outbox'
const traceStore = 'traces'

export type MutableCollection = 'recipes' | 'coffee-bags'
export type OutboxOperation = 'upsert' | 'delete'
export interface CollectionCache<T> extends Collection<T> { schemaVersion: 2; collectionVersion: 1; fetchedAt: string }
export interface MutationOutboxEntry<T = BrewRecipe | CoffeeBag> {
  schemaVersion: 2
  id: string
  sequence: number
  kind: 'mutation'
  collection: MutableCollection
  recordId: string
  operation: OutboxOperation
  payload?: T
  baseRevision: number
  baseRecord?: T
  createdAt: string
  attempts: number
}
export interface BrewOutboxEntry {
  schemaVersion: 2
  id: string
  sequence: number
  kind: 'brew'
  record: BrewRecord
  trace?: ArrayBuffer
  coffeeBagId?: string
  doseG?: number
  createdAt: string
  attempts: number
}
export type LibraryOutboxEntry = MutationOutboxEntry | BrewOutboxEntry
interface TraceEntry { id: string; bytes: ArrayBuffer; accessedAt: number; byteLength: number }

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(cacheStore)) database.createObjectStore(cacheStore)
      if (!database.objectStoreNames.contains(outboxStore)) database.createObjectStore(outboxStore, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(traceStore)) database.createObjectStore(traceStore, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('PourFrame browser storage upgrade is blocked.'))
  })
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => IDBRequest<T>) {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(stores, mode)
    const request = run(tx)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    tx.onabort = () => reject(tx.error)
  }).finally(() => database.close())
}

function validEnvelope<T>(raw: unknown, normalize: (item: unknown) => T | undefined, maximum: number): CollectionCache<T> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<CollectionCache<unknown>>
  if ((value.schemaVersion !== undefined && value.schemaVersion !== 2) || (value.collectionVersion !== undefined && value.collectionVersion !== 1) || value.v !== 1 || !Number.isInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.items) || value.items.length > maximum) return undefined
  const items: T[] = []
  for (const item of value.items) {
    const normalized = normalize(item)
    if (!normalized) return undefined
    items.push(normalized)
  }
  return { schemaVersion: 2, collectionVersion: 1, v: 1, revision: Number(value.revision), items, fetchedAt: typeof value.fetchedAt === 'string' && !Number.isNaN(Date.parse(value.fetchedAt)) ? value.fetchedAt : new Date(0).toISOString() }
}

function recipe(item: unknown) {
  try { const value = migrateRecipe(item as BrewRecipe); return validateRecipe(value).valid ? value : undefined } catch { return undefined }
}
function bag(item: unknown) {
  try { const value = normalizeCoffeeBag(item as CoffeeBag); return validateCoffeeBag(value).valid ? value : undefined } catch { return undefined }
}
function brew(item: unknown) {
  const value = item as Partial<BrewRecord>
  return value && typeof value.id === 'string' && typeof value.completed_at === 'string' && value.recipe ? value as BrewRecord : undefined
}

export function cacheEnvelope<T>(collection: Collection<T>): CollectionCache<T> {
  return { ...collection, schemaVersion: 2, collectionVersion: 1, fetchedAt: new Date().toISOString() }
}

export async function readCachedCollections() {
  const database = await openDatabase()
  try {
    const tx = database.transaction(cacheStore)
    const get = <T>(key: string) => new Promise<T | undefined>((resolve, reject) => {
      const request = tx.objectStore(cacheStore).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error)
    })
    const [recipes, brews, coffeeBags] = await Promise.all([get('recipes'), get('brews'), get('coffee-bags')])
    return { recipes: validEnvelope(recipes, recipe, 24), brews: validEnvelope(brews, brew, 5), coffeeBags: validEnvelope(coffeeBags, bag, 24) }
  } finally { database.close() }
}

export async function putCachedCollection<T>(key: 'recipes' | 'brews' | 'coffee-bags', collection: Collection<T>) {
  await transaction([cacheStore], 'readwrite', (tx) => tx.objectStore(cacheStore).put(cacheEnvelope(collection), key))
}

function migrateOutbox(value: unknown): LibraryOutboxEntry | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Partial<LibraryOutboxEntry> & { record?: BrewRecord; trace?: ArrayBuffer; coffeeBagId?: string; doseG?: number }
  if (item.schemaVersion === 2 && (item.kind === 'mutation' || item.kind === 'brew') && typeof item.id === 'string') return item as LibraryOutboxEntry
  if (item.record?.id) return { schemaVersion: 2, id: item.record.id, sequence: Date.parse(item.record.completed_at) || Date.now(), kind: 'brew', record: item.record, trace: item.trace, coffeeBagId: item.coffeeBagId, doseG: item.doseG, createdAt: item.record.completed_at, attempts: 0 }
  const legacyRecord = value as Partial<BrewRecord>
  if (legacyRecord.id && legacyRecord.recipe && legacyRecord.completed_at) return { schemaVersion: 2, id: legacyRecord.id, sequence: Date.parse(legacyRecord.completed_at) || Date.now(), kind: 'brew', record: legacyRecord as BrewRecord, createdAt: legacyRecord.completed_at, attempts: 0 }
  return undefined
}

export async function readOutbox() {
  if (typeof indexedDB === 'undefined') return []
  const raw = await transaction<unknown[]>([outboxStore], 'readonly', (tx) => tx.objectStore(outboxStore).getAll())
  return raw.map(migrateOutbox).filter((item): item is LibraryOutboxEntry => Boolean(item)).sort((a, b) => a.sequence - b.sequence)
}

export async function putOutbox(entry: LibraryOutboxEntry) {
  await transaction([outboxStore], 'readwrite', (tx) => tx.objectStore(outboxStore).put(entry))
}

export async function deleteOutbox(id: string) {
  await transaction([outboxStore], 'readwrite', (tx) => tx.objectStore(outboxStore).delete(id))
}

export async function commitCollectionAndDeleteOutbox<T>(key: 'recipes' | 'brews' | 'coffee-bags', collection: Collection<T>, outboxId: string) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction([cacheStore, outboxStore], 'readwrite')
      tx.objectStore(cacheStore).put(cacheEnvelope(collection), key)
      tx.objectStore(outboxStore).delete(outboxId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { database.close() }
}

export function applyMutationProjection<T extends { id: string }>(items: T[], entries: MutationOutboxEntry[]) {
  const projected = new Map(items.map((item) => [item.id, item]))
  for (const entry of entries) {
    if (entry.operation === 'delete') projected.delete(entry.recordId)
    else if (entry.payload) projected.set(entry.recordId, entry.payload as unknown as T)
  }
  return [...projected.values()]
}

export function mutationDisposition<T extends { id: string }>(entry: MutationOutboxEntry, latest: Collection<T>): 'already-applied' | 'safe' | 'conflict' {
  const target = latest.items.find((item) => item.id === entry.recordId)
  if (entry.operation === 'delete' && !target) return 'already-applied'
  return JSON.stringify(target) === JSON.stringify(entry.baseRecord) ? 'safe' : 'conflict'
}

export async function readTraceCache(id: string): Promise<Uint8Array | undefined> {
  const entry = await transaction<TraceEntry | undefined>([traceStore], 'readonly', (tx) => tx.objectStore(traceStore).get(id))
  if (!entry) return undefined
  entry.accessedAt = Date.now()
  void transaction([traceStore], 'readwrite', (tx) => tx.objectStore(traceStore).put(entry)).catch(() => undefined)
  return new Uint8Array(entry.bytes)
}

export async function putTraceCache(id: string, bytes: Uint8Array) {
  const stored = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  await transaction([traceStore], 'readwrite', (tx) => tx.objectStore(traceStore).put({ id, bytes: stored, byteLength: bytes.byteLength, accessedAt: Date.now() } satisfies TraceEntry))
  const entries = await transaction<TraceEntry[]>([traceStore], 'readonly', (tx) => tx.objectStore(traceStore).getAll())
  entries.sort((a, b) => b.accessedAt - a.accessedAt)
  let bytesKept = 0
  const remove = entries.filter((entry, index) => { bytesKept += entry.byteLength; return index >= 3 || bytesKept > 2 * 1024 * 1024 })
  await Promise.all(remove.map((entry) => transaction([traceStore], 'readwrite', (tx) => tx.objectStore(traceStore).delete(entry.id))))
}
