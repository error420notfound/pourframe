import type { MeasurementState, PairStatus } from './types'

export type GrindSize = 'Fine' | 'Medium-fine' | 'Medium' | 'Medium-coarse' | 'Coarse'
export type RoastLevel = 'Light' | 'Medium-light' | 'Medium' | 'Medium-dark' | 'Dark'
export type BeanForm = 'Whole bean' | 'Pre-ground'
export type BrewPhase = 'IDLE' | 'PREPARING' | 'READY' | 'STEP_COUNTDOWN' | 'WAITING_FOR_STABLE_BASELINE' | 'POUR_ACTIVE' | 'PAUSED' | 'DRAWDOWN' | 'COMPLETE' | 'ERROR'
export type BrewStatus = 'idle' | 'preparing' | 'brewing' | 'paused' | 'complete'
export type BrewMode = 'device' | 'timer_only'

export interface BrewRecipe {
  id: string
  name: string
  dripper: string
  coffee: number
  water: number
  ratio: number
  grind: GrindSize
  bloom: number
  poursAfterBloom: number
  /** Legacy v1 field. Read literally, then migrate to poursAfterBloom. */
  pours?: number
  brewTime: number
  flowRate: number
  temperature: number
  agitation: string
  equipment: string[]
  notes: string
  bloomEdited?: boolean
}

export interface CoffeeBag {
  id: string
  name: string
  roastery: string
  roastedOn: string
  roastLevel: RoastLevel
  beanForm: BeanForm
  grind?: GrindSize
  tastingNotes: string[]
  acidity?: number
  bitterness?: number
  originalWeightG: number
  remainingWeightG: number
  altitudeM?: number
  origin: string
  farm: string
  processing: string[]
  createdAt: string
  updatedAt: string
}

export type CoffeeBagSnapshot = Omit<CoffeeBag, 'remainingWeightG' | 'createdAt' | 'updatedAt'>

export interface BrewStep {
  id: string
  name: string
  start: number
  duration: number
  pour: number
  cumulative: number
  instruction: string
  kind: 'pour' | 'drawdown'
}

export interface StepBaseline {
  step_id: string
  step_index: number
  upper_g: number
  lower_g: number
  total_g: number
  device_sample_ms: number
  actual_elapsed_ms: number
  actual_timestamp: string
  scheduled_elapsed_ms: number
  source: 'automatic' | 'manual'
  reduced_confidence: boolean
}

export interface StepTransition {
  transition_id: string
  step_id: string
  scheduled_elapsed_ms: number
  actual_elapsed_ms: number | null
  actual_timestamp: string | null
  outcome: 'automatic' | 'manual' | 'missed' | 'cancelled'
  cue: 'completed' | 'unavailable' | 'cancelled' | 'health_aborted' | 'not_required'
  reduced_confidence: boolean
}

export interface SensorSummary {
  mode: BrewMode
  samples: number
  upper_available_frames: number
  lower_available_frames: number
  partial_frames: number
  confidence_min: number | null
  confidence_mean: number | null
  confidence_final: number | null
  final_state: MeasurementState | null
  pair_status_counts: Record<PairStatus, number>
}

export interface TraceMetadata {
  schema: 1
  sample_hz: 10
  sample_count: number
  byte_length: number
  crc32: string
  available: boolean
}

export interface BrewRecord {
  id: string
  completed_at: string
  elapsed_s: number
  recipe: BrewRecipe
  schedule: BrewStep[]
  baselines: StepBaseline[]
  transitions: StepTransition[]
  final: { upper_g: number | null; lower_g: number | null; total_g: number | null; beverage_g: number | null }
  sensor_summary: SensorSummary
  trace: TraceMetadata | null
  coffee_bag?: CoffeeBagSnapshot | null
  coffee_used_g?: number | null
}

export interface Collection<T> { v: 1; revision: number; items: T[] }
