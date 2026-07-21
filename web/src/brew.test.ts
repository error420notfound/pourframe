import { describe, expect, it, vi } from 'vitest'
import { buildSchedule, formatRecipeInput, migrateRecipe, updateRecipeNumber, validateRecipe } from './brew'
import { captureBaseline, completePairedTelemetry, initialBrewMachine, reduceBrewMachine, relativeReadings, stablePairedTelemetry } from './brewMachine'
import { addSensorSample, newSensorSummary, prepareDevice } from './brewSession'
import { defaultRecipes } from './defaultRecipes'
import { LibraryApiError, parseLegacyBrews, parseLegacyRecipes, retainNewestBrews, retryOnConflict } from './library'
import { decodeTrace, encodeTrace, traceSample } from './trace'
import type { DeviceTelemetry, ProtocolAck } from './types'
import type { BrewMachineState } from './brewMachine'
import { usableScale, validTelemetry } from './useDevice'

function telemetry(partial = false, stable = true): DeviceTelemetry {
  const scale = { raw: 1, grams: 10, median_raw: 1, calibrated: 10, innovation_g: 0, filter_alpha: .3, filter_tau_s: .25, updated: true, slope_g_s: 0, range_g: .1, available: true, ready: true, stale: false, disconnected: false, calibrating: false, calibration_valid: true, saturated: false, cadence_valid: true, last_sample_ms: 100 }
  return { v: 1, type: 'telemetry', seq: 1, uptime_ms: 100, hostname: 'pourframe.local', wifi: { connected: true, provisioning: false, ssid: 'wifi', rssi: -50, ip: '1.2.3.4' }, scales: { upper: { ...scale }, lower: { ...scale, available: !partial, ready: !partial, stale: partial, disconnected: partial } }, total: { grams: 20, available: true, partial, upper_included: true, lower_included: !partial, slope_g_s: 0, range_g: .1, pour_rate_g_s: 0, transfer_residual_g_s: 0, pair_status: partial ? 'retained_peer' : 'synchronized', led_state: 'normal', led_proximity: 0 }, measurement: { seq: 1, new_snapshot: true, sample_timestamp_ms: 100, upper_sample_timestamp_ms: 100, lower_sample_timestamp_ms: 100, state: stable ? 'STABLE' : 'ACTIVE', candidate_state: stable ? 'STABLE' : 'ACTIVE', is_stable: stable, confidence: partial ? .3 : .9, alpha: .3, sample_rate_hz: 10, upper_sample_rate_hz: 10, lower_sample_rate_hz: partial ? 0 : 10, pair_skew_us: 10, pair_tolerance_us: 100, pair_valid: !partial, pair_status: partial ? 'retained_peer' : 'synchronized', dropped_samples: 0, partial_samples: partial ? 1 : 0, upper_updated: true, lower_updated: !partial, upper_innovation_g: 0, lower_innovation_g: 0, upper_alpha: .3, lower_alpha: .3, upper_tau_s: .25, lower_tau_s: .25 } }
}

const ack = (id: string): ProtocolAck => ({ v: 1, type: 'ack', id, ok: true, message: 'ok' })

describe('recipe semantics', () => {
  it('uses four pours after bloom for the 20 g 1:16 example', () => {
    const recipe = { ...defaultRecipes[0], coffee: 20, ratio: 16, water: 320, bloom: 60, poursAfterBloom: 4 }
    const pours = buildSchedule(recipe).filter((step) => step.kind === 'pour')
    expect(pours.map((step) => step.pour)).toEqual([60, 65, 65, 65, 65])
    expect(pours.map((step) => step.cumulative)).toEqual([60, 125, 190, 255, 320])
  })

  it('keeps uneven division precise and forces the final cumulative target', () => {
    const pours = buildSchedule({ ...defaultRecipes[0], water: 321, bloom: 60, poursAfterBloom: 4 }).filter((step) => step.kind === 'pour')
    expect(pours[1].pour).toBe(65.25)
    expect(pours.at(-1)?.cumulative).toBe(321)
    expect(pours.reduce((total, step) => total + step.pour, 0)).toBe(321)
  })

  it('updates coupled fields in one event without rounding loops', () => {
    const coffee = updateRecipeNumber(defaultRecipes[0], 'coffee', 20.25)
    expect(coffee.water).toBe(324)
    expect(coffee.bloom).toBe(defaultRecipes[0].bloom)
    const water = updateRecipeNumber(coffee, 'water', 333)
    expect(water.coffee).toBe(20.25)
    expect(water.ratio).toBe(333 / 20.25)
    expect(updateRecipeNumber(water, 'ratio', 16.25).water).toBe(20.25 * 16.25)
    expect(formatRecipeInput(water.ratio)).toBe('16.444')
    expect(water.ratio).toBe(333 / 20.25)
  })

  it('migrates legacy pours literally and validates bloom', () => {
    const legacy = { ...defaultRecipes[0], poursAfterBloom: undefined, pours: 4 } as unknown as typeof defaultRecipes[number]
    expect(migrateRecipe(legacy).poursAfterBloom).toBe(4)
    expect(validateRecipe({ ...defaultRecipes[0], bloom: 320 }).errors.bloom).toBeTruthy()
  })
})

describe('device preparation and virtual baselines', () => {
  it('waits for both tares before setting the target', async () => {
    const calls: string[] = []
    const send = vi.fn(async (command: string, channel: string) => { calls.push(`${command}:${channel}`); return ack(channel) })
    await expect(prepareDevice('online', telemetry(), 320, send)).resolves.toMatchObject({ kind: 'ready' })
    expect(calls.slice(0, 2).sort()).toEqual(['tare:lower', 'tare:upper'])
    expect(calls[2]).toBe('set_target:total')
  })

  it('blocks partial or unstable preparation without sending a tare', async () => {
    const send = vi.fn(async (_command: string, channel: string) => ack(channel))
    await expect(prepareDevice('online', telemetry(true), 320, send)).resolves.toMatchObject({ kind: 'timer' })
    await expect(prepareDevice('online', telemetry(false, false), 320, send)).resolves.toMatchObject({ kind: 'timer' })
    expect(send).not.toHaveBeenCalled()
  })

  it('captures a baseline only from stable paired telemetry and computes relatives', () => {
    const step = buildSchedule(defaultRecipes[0])[0]
    const captured = captureBaseline(telemetry(), step, 0, 0, 'brew:bloom', 'automatic')
    expect(captured?.baseline.total_g).toBe(20)
    expect(captureBaseline(telemetry(true), step, 0, 0, 'bad', 'automatic')).toBeNull()
    const next = telemetry(); next.scales.upper.grams = 15; next.scales.lower.grams = 20; next.total.grams = 35
    expect(relativeReadings(next, captured?.baseline)).toEqual({ relativeUpper: 5, relativeLower: 10, stepWaterAdded: 15 })
  })

  it('does not apply duplicate transitions twice', () => {
    const step = buildSchedule(defaultRecipes[0])[0]
    const captured = captureBaseline(telemetry(), step, 0, 0, 'brew:bloom', 'automatic')!
    let state: BrewMachineState = { ...initialBrewMachine(), phase: 'WAITING_FOR_STABLE_BASELINE' }
    state = reduceBrewMachine(state, { type: 'ACTIVATE', ...captured })
    state = reduceBrewMachine(state, { type: 'ACTIVATE', ...captured })
    expect(state.baselines).toHaveLength(1)
    expect(state.transitions).toHaveLength(1)
  })

  it('freezes elapsed time while paused and resumes with a new cue generation', () => {
    let state: BrewMachineState = { ...initialBrewMachine(), phase: 'POUR_ACTIVE', elapsedMs: 2000, countdownGeneration: 2 }
    state = reduceBrewMachine(state, { type: 'PAUSE' })
    state = reduceBrewMachine(state, { type: 'TICK', elapsedMs: 9000 })
    expect(state.elapsedMs).toBe(2000)
    state = reduceBrewMachine(state, { type: 'RESUME' })
    expect(state.phase).toBe('POUR_ACTIVE')
    expect(state.countdownGeneration).toBe(3)
  })

  it('resets transient state without inventing another preparation', () => {
    const dirty: BrewMachineState = { ...initialBrewMachine(), phase: 'ERROR', brewId: 'brew-1', error: 'tare failed', activeCueId: 'cue-1' }
    expect(reduceBrewMachine(dirty, { type: 'RESET' })).toEqual(initialBrewMachine())
  })

  it('records an explicit timer-only transition as reduced confidence', () => {
    const transition = { transition_id: 'brew:pour-1', step_id: 'pour-1', scheduled_elapsed_ms: 32000, actual_elapsed_ms: 35000, actual_timestamp: new Date(0).toISOString(), outcome: 'missed' as const, cue: 'unavailable' as const, reduced_confidence: true }
    const state = reduceBrewMachine({ ...initialBrewMachine(), phase: 'WAITING_FOR_STABLE_BASELINE', mode: 'timer_only' }, { type: 'ACTIVATE_TIMER', stepIndex: 1, transition })
    expect(state.currentStepIndex).toBe(1)
    expect(state.transitions).toEqual([transition])
    expect(state.reducedConfidence).toBe(true)
  })
})

describe('10 Hz trace format', () => {
  it('round-trips absolute, relative, health, and rate fields', () => {
    const sample = telemetry()
    const baseline = captureBaseline(sample, buildSchedule(defaultRecipes[0])[0], 0, 0, 'id', 'automatic')!.baseline
    sample.scales.upper.grams = 12; sample.scales.lower.grams = 15; sample.total.grams = 27; sample.total.pour_rate_g_s = 4.5
    const encoded = encodeTrace([traceSample(sample, baseline, 100, 0)])
    const decoded = decodeTrace(encoded.bytes)[0]
    expect(decoded.total).toBe(27)
    expect(decoded.stepWaterAdded).toBe(7)
    expect(decoded.pourRate).toBe(4.5)
    expect(decoded.confidence).toBeCloseTo(sample.measurement.confidence, 2)
    expect(encoded.metadata.sample_hz).toBe(10)
  })

  it('bounds a seven-minute 10 Hz trace to 138616 bytes', () => {
    const item = traceSample(telemetry(), undefined, 0, 0)
    expect(encodeTrace(Array.from({ length: 4200 }, (_, index) => ({ ...item, elapsedMs: index * 100 }))).bytes.byteLength).toBe(138616)
  })

  it('rejects corruption', () => {
    const encoded = encodeTrace([traceSample(telemetry(), undefined, 0, 0)])
    encoded.bytes[20] ^= 1
    expect(() => decodeTrace(encoded.bytes)).toThrow('checksum')
  })
})

describe('telemetry and shared data safeguards', () => {
  it('rejects malformed telemetry and aggregates reported confidence', () => {
    expect(validTelemetry({ v: 1, type: 'telemetry' })).toBe(false)
    expect(usableScale(telemetry(true).scales.lower)).toBe(false)
    expect(completePairedTelemetry(telemetry(false, false))).toBe(true)
    expect(stablePairedTelemetry(telemetry())).toBe(true)
    const summary = addSensorSample(addSensorSample(newSensorSummary('device'), telemetry()), telemetry(true))
    expect(summary.samples).toBe(2); expect(summary.partial_frames).toBe(1); expect(summary.confidence_mean).toBeCloseTo(.6)
  })

  it('retries one revision conflict after refreshing', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new LibraryApiError(409, 'revision_conflict', 'conflict')).mockResolvedValue('saved')
    const refresh = vi.fn().mockResolvedValue(undefined)
    await expect(retryOnConflict(operation, refresh)).resolves.toBe('saved')
    expect(operation).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledOnce()
  })

  it('migrates legacy recipes and histories to the new explicit schema', () => {
    const legacy = { ...defaultRecipes[0], poursAfterBloom: undefined, pours: 4 }
    expect(parseLegacyRecipes(JSON.stringify([legacy]))[0].poursAfterBloom).toBe(4)
    const brews = parseLegacyBrews(JSON.stringify([{ id: 'old', date: '2025-01-02', elapsed: 180, recipe: legacy }]))
    expect(brews[0].sensor_summary.mode).toBe('timer_only'); expect(brews[0].trace).toBeNull(); expect(brews[0].final.beverage_g).toBeNull()
  })

  it('retains exactly the five newest completed brews', () => {
    const recipe = defaultRecipes[0]
    const records = Array.from({ length: 7 }, (_, index) => ({ id: `brew-${index}`, completed_at: new Date(index * 1000).toISOString(), elapsed_s: 180, recipe, schedule: buildSchedule(recipe), baselines: [], transitions: [], final: { upper_g: null, lower_g: null, total_g: null, beverage_g: null }, sensor_summary: newSensorSummary('timer_only'), trace: null }))
    expect(retainNewestBrews(records).map((record) => record.id)).toEqual(['brew-6', 'brew-5', 'brew-4', 'brew-3', 'brew-2'])
  })
})
