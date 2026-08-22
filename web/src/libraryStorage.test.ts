import { describe, expect, it } from 'vitest'
import { applyMutationProjection, cacheEnvelope, mutationDisposition, type MutationOutboxEntry } from './libraryStorage'
import { defaultRecipes } from './defaultRecipes'

describe('offline library projections', () => {
  it('wraps last-good collections in the v2 cache contract', () => {
    expect(cacheEnvelope({ v: 1, revision: 7, items: defaultRecipes })).toMatchObject({ schemaVersion: 2, collectionVersion: 1, v: 1, revision: 7 })
  })

  it('overlays ordered pending upserts and deletes without changing the baseline', () => {
    const base = defaultRecipes.slice(0, 2)
    const changed = { ...base[0], name: 'Offline edit' }
    const entries: MutationOutboxEntry[] = [
      { schemaVersion: 2, id: 'one', sequence: 1, kind: 'mutation', collection: 'recipes', recordId: changed.id, operation: 'upsert', payload: changed, baseRevision: 1, baseRecord: base[0], createdAt: new Date(0).toISOString(), attempts: 0 },
      { schemaVersion: 2, id: 'two', sequence: 2, kind: 'mutation', collection: 'recipes', recordId: base[1].id, operation: 'delete', baseRevision: 1, baseRecord: base[1], createdAt: new Date(0).toISOString(), attempts: 0 },
    ]
    expect(applyMutationProjection(base, entries)).toEqual([changed])
    expect(base[0].name).not.toBe('Offline edit')
  })

  it('rebases unrelated revision changes but gives the ESP the same-record conflict', () => {
    const base = defaultRecipes[0]
    const entry: MutationOutboxEntry = { schemaVersion: 2, id: 'edit', sequence: 1, kind: 'mutation', collection: 'recipes', recordId: base.id, operation: 'upsert', payload: { ...base, name: 'Browser edit' }, baseRevision: 1, baseRecord: base, createdAt: new Date(0).toISOString(), attempts: 0 }
    expect(mutationDisposition(entry, { v: 1, revision: 2, items: [base, defaultRecipes[1]] })).toBe('safe')
    expect(mutationDisposition(entry, { v: 1, revision: 2, items: [{ ...base, name: 'ESP edit' }] })).toBe('conflict')
    expect(mutationDisposition({ ...entry, operation: 'delete' }, { v: 1, revision: 2, items: [] })).toBe('already-applied')
  })
})
