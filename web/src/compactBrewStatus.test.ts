import { describe, expect, it } from 'vitest'
import { deriveCompactBrewStatus } from './compactBrewStatus'

describe('compact active-brew status', () => {
  it('uses the active recipe and stage targets', () => {
    expect(deriveCompactBrewStatus({
      recipe: { name: 'Balanced V60', brewTime: 180 },
      step: { name: 'Pour 2', cumulative: 180 },
      elapsed: 72,
      currentWeight: 162.4,
    })).toEqual({ recipeName: 'Balanced V60', stageName: 'Pour 2', elapsed: 72, targetTime: 180, currentWeight: 162.4, targetWeight: 180 })
  })

  it('keeps current values but hides recipe targets for a future manual brew', () => {
    expect(deriveCompactBrewStatus({ recipe: null, step: null, elapsed: 24, currentWeight: 41 })).toEqual({
      recipeName: 'Manual brew', stageName: 'Brewing', elapsed: 24, targetTime: null, currentWeight: 41, targetWeight: null,
    })
  })

  it('marks unavailable or invalid readings as unavailable', () => {
    expect(deriveCompactBrewStatus({ recipe: null, step: null, elapsed: -3, currentWeight: Number.NaN }).currentWeight).toBeNull()
    expect(deriveCompactBrewStatus({ recipe: null, step: null, elapsed: -3, currentWeight: Number.NaN }).elapsed).toBe(0)
  })
})
