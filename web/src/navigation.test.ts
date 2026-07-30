import { describe, expect, it } from 'vitest'
import { appHash, parseAppHash } from './navigation'

describe('hash navigation', () => {
  it('creates stable anchors for primary and recipe tabs', () => {
    expect(appHash('brew')).toBe('#brew')
    expect(appHash('history')).toBe('#history')
    expect(appHash('device')).toBe('#device')
    expect(appHash('recipes', 'coffee')).toBe('#recipes/coffee-bags')
    expect(appHash('recipes', 'recipes')).toBe('#recipes/brew-recipes')
  })

  it('opens direct recipe anchors in the matching nested tab', () => {
    expect(parseAppHash('#recipes/coffee-bags')).toEqual({ tab: 'recipes', recipeLibraryView: 'coffee' })
    expect(parseAppHash('#recipes/brew-recipes')).toEqual({ tab: 'recipes', recipeLibraryView: 'recipes' })
  })

  it('keeps the saved recipe section for the short recipes anchor', () => {
    expect(parseAppHash('#recipes', 'recipes')).toEqual({ tab: 'recipes', recipeLibraryView: 'recipes' })
  })

  it('falls back safely for empty and unknown anchors', () => {
    expect(parseAppHash('')).toEqual({ tab: 'brew', recipeLibraryView: 'coffee' })
    expect(parseAppHash('#unknown', 'recipes')).toEqual({ tab: 'brew', recipeLibraryView: 'recipes' })
  })
})
