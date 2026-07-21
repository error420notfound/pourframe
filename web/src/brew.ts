import type { BrewRecipe, BrewStep } from './brewTypes'

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum)

export const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export function formatRecipeWeight(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
}

export function formatRecipeInput(value: number) {
  if (!Number.isFinite(value)) return ''
  return String(Math.round(value * 1000) / 1000)
}

export function migrateRecipe(recipe: BrewRecipe | (Omit<BrewRecipe, 'poursAfterBloom'> & { pours: number })): BrewRecipe {
  const legacy = recipe as BrewRecipe & { pours?: number }
  return {
    ...legacy,
    poursAfterBloom: Number.isFinite(legacy.poursAfterBloom) ? legacy.poursAfterBloom : legacy.pours ?? 1,
    pours: undefined,
  }
}

export interface RecipeValidation { valid: boolean; errors: Partial<Record<'coffee' | 'water' | 'ratio' | 'bloom' | 'poursAfterBloom', string>> }

export function validateRecipe(input: BrewRecipe): RecipeValidation {
  const recipe = migrateRecipe(input)
  const errors: RecipeValidation['errors'] = {}
  if (!Number.isFinite(recipe.coffee) || recipe.coffee <= 0 || recipe.coffee > 80) errors.coffee = 'Coffee must be greater than 0 g and no more than 80 g.'
  if (!Number.isFinite(recipe.water) || recipe.water <= 0 || recipe.water > 1200) errors.water = 'Water must be greater than 0 g and no more than 1200 g.'
  if (!Number.isFinite(recipe.ratio) || recipe.ratio <= 0 || recipe.ratio > 30) errors.ratio = 'Ratio must be greater than 0 and no more than 30.'
  if (!Number.isFinite(recipe.bloom) || recipe.bloom <= 0 || recipe.bloom >= recipe.water) errors.bloom = 'Bloom must be greater than 0 g and less than total water.'
  if (!Number.isInteger(recipe.poursAfterBloom) || recipe.poursAfterBloom < 1 || recipe.poursAfterBloom > 6) errors.poursAfterBloom = 'Pours after bloom must be a whole number from 1 to 6.'
  return { valid: Object.keys(errors).length === 0, errors }
}

export function normalizeRecipe(input: BrewRecipe): BrewRecipe {
  const recipe = migrateRecipe(input)
  return {
    ...recipe,
    brewTime: Math.round(clamp(recipe.brewTime, 90, 420)),
    flowRate: clamp(recipe.flowRate, 1, 8),
    temperature: Math.round(clamp(recipe.temperature, 80, 100)),
  }
}

export function updateRecipeNumber(input: BrewRecipe, field: keyof BrewRecipe, value: number): BrewRecipe {
  const recipe = migrateRecipe(input)
  if (field === 'coffee') return { ...recipe, coffee: value, water: value * recipe.ratio }
  if (field === 'ratio') return { ...recipe, ratio: value, water: recipe.coffee * value }
  if (field === 'water') return { ...recipe, water: value, ratio: recipe.coffee > 0 ? value / recipe.coffee : recipe.ratio }
  if (field === 'bloom') return { ...recipe, bloom: value, bloomEdited: true }
  return { ...recipe, [field]: value }
}

export function buildSchedule(input: BrewRecipe): BrewStep[] {
  const recipe = normalizeRecipe(input)
  const pourCount = Math.max(1, Math.round(recipe.poursAfterBloom))
  const remainingWater = recipe.water - recipe.bloom
  const increment = remainingWater / pourCount
  const bloomDuration = clamp(Math.round(recipe.brewTime * 0.18), 25, 45)
  const interval = Math.max((recipe.brewTime - bloomDuration) / pourCount, 1)
  const steps: BrewStep[] = [{
    id: 'bloom', name: 'Bloom', start: 0, duration: bloomDuration, pour: recipe.bloom, cumulative: recipe.bloom,
    instruction: 'Pour in a slow spiral to saturate all the grounds, then let the coffee bloom.', kind: 'pour',
  }]
  for (let index = 0; index < pourCount; index += 1) {
    const finalPour = index === pourCount - 1
    const cumulative = finalPour ? recipe.water : recipe.bloom + increment * (index + 1)
    const previous = index === 0 ? recipe.bloom : recipe.bloom + increment * index
    steps.push({
      id: `pour-${index + 1}`,
      name: finalPour ? 'Final pour' : `Pour ${index + 1}`,
      start: bloomDuration + interval * index,
      duration: interval,
      pour: finalPour ? recipe.water - previous : increment,
      cumulative,
      instruction: finalPour ? `Pour to ${formatRecipeWeight(cumulative)} g, then let the bed drain evenly.` : `Pour steadily to ${formatRecipeWeight(cumulative)} g total.`,
      kind: 'pour',
    })
  }
  steps.push({ id: 'drawdown', name: 'Drawdown', start: recipe.brewTime, duration: 0, pour: 0, cumulative: recipe.water, instruction: 'Let the bed drain, then remove the dripper.', kind: 'drawdown' })
  return steps
}

export function activeStepIndex(steps: BrewStep[], elapsed: number) {
  let active = 0
  for (let index = 0; index < steps.length; index += 1) if (elapsed >= steps[index].start) active = index
  return active
}
