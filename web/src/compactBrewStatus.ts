import type { BrewRecipe, BrewStep } from './brewTypes'

export interface CompactBrewStatus {
  recipeName: string
  stageName: string
  elapsed: number
  targetTime: number | null
  currentWeight: number | null
  targetWeight: number | null
}

export function deriveCompactBrewStatus(input: {
  recipe: Pick<BrewRecipe, 'name' | 'brewTime'> | null
  step: Pick<BrewStep, 'name' | 'cumulative'> | null
  elapsed: number
  currentWeight: number | null
}): CompactBrewStatus {
  const recipeName = input.recipe?.name.trim() || 'Manual brew'
  const stageName = input.step?.name.trim() || 'Brewing'
  return {
    recipeName,
    stageName,
    elapsed: Math.max(0, input.elapsed),
    targetTime: input.recipe?.brewTime ?? null,
    currentWeight: Number.isFinite(input.currentWeight) ? input.currentWeight : null,
    targetWeight: input.recipe && input.step ? input.step.cumulative : null,
  }
}
