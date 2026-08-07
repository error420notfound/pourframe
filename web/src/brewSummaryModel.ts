import { completePairedTelemetry, type BrewMachineState } from './brewMachine'
import type { BrewMode, BrewRecipe, BrewStatus, BrewStep } from './brewTypes'
import type { DeviceTelemetry } from './types'

export type ActiveBrewWeightState = 'available' | 'timer_only' | 'unavailable'

export interface ActiveBrewSummaryModel {
  progress: number
  progressPercent: number
  step: BrewStep
  next: BrewStep | null
  totalWater: number | null
  remainingWater: number | null
  weightState: ActiveBrewWeightState
}

interface ActiveBrewSummaryInput {
  recipe: BrewRecipe
  schedule: BrewStep[]
  status: BrewStatus
  elapsed: number
  mode: BrewMode
  telemetry: DeviceTelemetry | null
  machine: BrewMachineState
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum)

export function deriveActiveBrewSummary({
  recipe,
  schedule,
  status,
  elapsed,
  mode,
  telemetry,
  machine,
}: ActiveBrewSummaryInput): ActiveBrewSummaryModel {
  const fallbackStep = schedule[0]
  if (!fallbackStep) throw new Error('Active brew summary requires at least one scheduled step.')

  const stepIndex = machine.phase === 'DRAWDOWN' || machine.phase === 'COMPLETE'
    ? schedule.length - 1
    : Math.max(0, machine.currentStepIndex)
  const step = schedule[stepIndex] ?? fallbackStep
  const next = status === 'complete' ? null : schedule[stepIndex + 1] ?? null
  const progress = recipe.brewTime > 0 ? clamp(elapsed / recipe.brewTime, 0, 1) : 0
  const totalWater = mode === 'device' && completePairedTelemetry(telemetry)
    ? telemetry!.total.grams
    : null

  return {
    progress,
    progressPercent: Math.round(progress * 100),
    step,
    next,
    totalWater,
    remainingWater: totalWater == null ? null : recipe.water - totalWater,
    weightState: totalWater != null ? 'available' : mode === 'timer_only' ? 'timer_only' : 'unavailable',
  }
}
