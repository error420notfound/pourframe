import { describe, expect, it } from 'vitest'
import { appHash, parseAppHash } from './navigation'

describe('hash navigation', () => {
  it('creates canonical anchors for the library-first shell', () => {
    expect(appHash('brew')).toBe('#brew')
    expect(appHash('history')).toBe('#history')
    expect(appHash('beans')).toBe('#beans')
    expect(appHash('recipes')).toBe('#recipes')
    expect(appHash('device')).toBe('#device')
  })

  it('keeps old recipe links working without making them canonical', () => {
    expect(parseAppHash('#recipes/coffee-bags')).toEqual({ tab: 'beans', recipeLibraryView: 'coffee' })
    expect(parseAppHash('#recipes/brew-recipes')).toEqual({ tab: 'recipes', recipeLibraryView: 'recipes' })
  })

  it('keeps the saved recipe section for the short recipes anchor', () => {
    expect(parseAppHash('#recipes', 'recipes')).toEqual({ tab: 'recipes', recipeLibraryView: 'recipes' })
  })

  it('falls back safely for empty and unknown anchors', () => {
    expect(parseAppHash('')).toEqual({ tab: 'history', recipeLibraryView: 'coffee' })
    expect(parseAppHash('#unknown', 'recipes')).toEqual({ tab: 'history', recipeLibraryView: 'recipes' })
  })
})
