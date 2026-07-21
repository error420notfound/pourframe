import type { BrewMode, BrewPhase, BrewStep, StepBaseline, StepTransition } from './brewTypes'
import type { DeviceTelemetry } from './types'
import { usableScale } from './useDevice'

export interface BrewMachineState {
  phase: BrewPhase
  mode: BrewMode
  brewId: string
  currentStepIndex: number
  elapsedMs: number
  countdownGeneration: number
  activeCueId: string | null
  baselines: StepBaseline[]
  transitions: StepTransition[]
  error: string | null
  reducedConfidence: boolean
}

export type BrewMachineEvent =
  | { type: 'PREPARE'; brewId: string }
  | { type: 'PREPARED'; mode: BrewMode }
  | { type: 'COUNTDOWN'; cueId: string; generation: number }
  | { type: 'WAIT_FOR_BASELINE' }
  | { type: 'ACTIVATE'; baseline: StepBaseline; transition: StepTransition }
  | { type: 'ACTIVATE_TIMER'; stepIndex: number; transition: StepTransition }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'TICK'; elapsedMs: number }
  | { type: 'DRAWDOWN' }
  | { type: 'COMPLETE' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' }

export function initialBrewMachine(): BrewMachineState {
  return { phase: 'IDLE', mode: 'device', brewId: '', currentStepIndex: -1, elapsedMs: 0, countdownGeneration: 0, activeCueId: null, baselines: [], transitions: [], error: null, reducedConfidence: false }
}

export function reduceBrewMachine(state: BrewMachineState, event: BrewMachineEvent): BrewMachineState {
  if (event.type === 'RESET') return initialBrewMachine()
  if (event.type === 'PREPARE' && state.phase === 'IDLE') return { ...initialBrewMachine(), phase: 'PREPARING', brewId: event.brewId }
  if (event.type === 'PREPARED' && state.phase === 'PREPARING') return { ...state, phase: 'READY', mode: event.mode, error: null }
  if (event.type === 'COUNTDOWN' && (state.phase === 'READY' || state.phase === 'POUR_ACTIVE' || state.phase === 'PAUSED')) return { ...state, phase: 'STEP_COUNTDOWN', activeCueId: event.cueId, countdownGeneration: event.generation }
  if (event.type === 'WAIT_FOR_BASELINE' && state.phase === 'STEP_COUNTDOWN') return { ...state, phase: 'WAITING_FOR_STABLE_BASELINE', activeCueId: null }
  if (event.type === 'ACTIVATE' && !state.transitions.some((value) => value.transition_id === event.transition.transition_id)) return { ...state, phase: 'POUR_ACTIVE', currentStepIndex: event.baseline.step_index, activeCueId: null, baselines: [...state.baselines, event.baseline], transitions: [...state.transitions, event.transition], reducedConfidence: state.reducedConfidence || event.baseline.reduced_confidence }
  if (event.type === 'ACTIVATE_TIMER' && !state.transitions.some((value) => value.transition_id === event.transition.transition_id)) return { ...state, phase: 'POUR_ACTIVE', currentStepIndex: event.stepIndex, activeCueId: null, transitions: [...state.transitions, event.transition], reducedConfidence: true }
  if (event.type === 'PAUSE' && (state.phase === 'POUR_ACTIVE' || state.phase === 'STEP_COUNTDOWN' || state.phase === 'WAITING_FOR_STABLE_BASELINE')) return { ...state, phase: 'PAUSED', activeCueId: null }
  if (event.type === 'RESUME' && state.phase === 'PAUSED') return { ...state, phase: 'POUR_ACTIVE', countdownGeneration: state.countdownGeneration + 1 }
  if (event.type === 'TICK' && state.phase !== 'PAUSED') return { ...state, elapsedMs: Math.max(state.elapsedMs, event.elapsedMs) }
  if (event.type === 'DRAWDOWN') return { ...state, phase: 'DRAWDOWN', activeCueId: null }
  if (event.type === 'COMPLETE') return { ...state, phase: 'COMPLETE', activeCueId: null }
  if (event.type === 'ERROR') return { ...state, phase: 'ERROR', error: event.message, activeCueId: null }
  return state
}

export function completePairedTelemetry(telemetry: DeviceTelemetry | null | undefined) {
  return Boolean(telemetry && usableScale(telemetry.scales.upper) && usableScale(telemetry.scales.lower) && telemetry.total.available && !telemetry.total.partial && telemetry.measurement.pair_valid && telemetry.measurement.pair_status === 'synchronized' && Number.isFinite(telemetry.total.grams))
}

export function stablePairedTelemetry(telemetry: DeviceTelemetry | null | undefined) {
  return completePairedTelemetry(telemetry) && Boolean(telemetry?.measurement.is_stable)
}

export function captureBaseline(telemetry: DeviceTelemetry, step: BrewStep, stepIndex: number, elapsedMs: number, transitionId: string, source: 'automatic' | 'manual'): { baseline: StepBaseline; transition: StepTransition } | null {
  if (!completePairedTelemetry(telemetry) || telemetry.total.grams == null) return null
  const now = new Date().toISOString()
  const reducedConfidence = source === 'manual' || !telemetry.measurement.is_stable
  const baseline: StepBaseline = { step_id: step.id, step_index: stepIndex, upper_g: telemetry.scales.upper.grams, lower_g: telemetry.scales.lower.grams, total_g: telemetry.total.grams, device_sample_ms: telemetry.measurement.sample_timestamp_ms, actual_elapsed_ms: elapsedMs, actual_timestamp: now, scheduled_elapsed_ms: Math.round(step.start * 1000), source, reduced_confidence: reducedConfidence }
  return { baseline, transition: { transition_id: transitionId, step_id: step.id, scheduled_elapsed_ms: Math.round(step.start * 1000), actual_elapsed_ms: elapsedMs, actual_timestamp: now, outcome: source, cue: 'completed', reduced_confidence: reducedConfidence } }
}

export function relativeReadings(telemetry: DeviceTelemetry | null, baseline: StepBaseline | undefined) {
  if (!telemetry || !baseline) return { relativeUpper: null, relativeLower: null, stepWaterAdded: null }
  return {
    relativeUpper: usableScale(telemetry.scales.upper) ? telemetry.scales.upper.grams - baseline.upper_g : null,
    relativeLower: usableScale(telemetry.scales.lower) ? telemetry.scales.lower.grams - baseline.lower_g : null,
    stepWaterAdded: completePairedTelemetry(telemetry) && telemetry.total.grams != null ? telemetry.total.grams - baseline.total_g : null,
  }
}
