import { describe, expect, it } from 'vitest'
import type { BrewMachineState } from './brewMachine'
import { insertNotification, isBrewNotificationContext, liveBrewNotificationCandidates, shouldDismissForSwipe, type BrewNotificationSeverity } from './brewNotifications'
import type { DeviceTelemetry } from './types'

const telemetry = (): DeviceTelemetry => ({
  v: 1, type: 'telemetry', seq: 1, uptime_ms: 1, hostname: 'pourframe.local', wifi: { connected: true, provisioning: false, ssid: 'Local', rssi: -50, ip: '192.168.1.2' },
  scales: { upper: { raw: 0, grams: 0, median_raw: 0, calibrated: 0, innovation_g: 0, filter_alpha: 0, filter_tau_s: 0, updated: true, slope_g_s: 0, range_g: 0, available: true, ready: true, stale: false, disconnected: false, calibrating: false, calibration_valid: true, saturated: false, cadence_valid: true, last_sample_ms: 1 }, lower: { raw: 0, grams: 0, median_raw: 0, calibrated: 0, innovation_g: 0, filter_alpha: 0, filter_tau_s: 0, updated: true, slope_g_s: 0, range_g: 0, available: true, ready: true, stale: false, disconnected: false, calibrating: false, calibration_valid: true, saturated: false, cadence_valid: true, last_sample_ms: 1 } },
  total: { grams: 0, available: true, partial: false, upper_included: true, lower_included: true, slope_g_s: 0, range_g: 0, pour_rate_g_s: 0, transfer_residual_g_s: 0, pair_status: 'synchronized', led_state: 'normal', led_proximity: 0 },
  measurement: { seq: 1, new_snapshot: true, sample_timestamp_ms: 1, upper_sample_timestamp_ms: 1, lower_sample_timestamp_ms: 1, state: 'STABLE', candidate_state: 'STABLE', is_stable: true, confidence: 1, alpha: 0, sample_rate_hz: 10, upper_sample_rate_hz: 10, lower_sample_rate_hz: 10, pair_skew_us: 0, pair_tolerance_us: 60_000, pair_valid: true, pair_status: 'synchronized', dropped_samples: 0, partial_samples: 0, upper_updated: true, lower_updated: true, upper_innovation_g: 0, lower_innovation_g: 0, upper_alpha: 0, lower_alpha: 0, upper_tau_s: 0, lower_tau_s: 0 },
})

const machine: BrewMachineState = { phase: 'POUR_ACTIVE', mode: 'device', brewId: 'brew', currentStepIndex: 0, elapsedMs: 0, countdownGeneration: 0, activeCueId: null, pausedFrom: null, baselines: [], transitions: [], error: null, reducedConfidence: false }

describe('live brew notifications', () => {
  it('maps a fifth failed reconnect to an actionable device-offline error', () => {
    const candidates = liveBrewNotificationCandidates({ active: true, availability: 'offline', connection: 'offline', reconnectAttempt: 5, telemetry: null, machine, brewStatus: 'paused', mode: 'device', prepStage: null, deviceBlocked: true, message: '' })
    expect(candidates).toContainEqual(expect.objectContaining({ key: 'device-offline', severity: 'error', action: 'reconnect' }))
    expect(candidates.some((candidate) => candidate.key === 'reconnecting')).toBe(false)
  })

  it('labels in-progress reconnect attempts with the bounded retry count', () => {
    const candidates = liveBrewNotificationCandidates({ active: true, availability: 'offline', connection: 'connecting', reconnectAttempt: 2, telemetry: null, machine, brewStatus: 'paused', mode: 'device', prepStage: null, deviceBlocked: false, message: '' })
    expect(candidates).toContainEqual(expect.objectContaining({ key: 'reconnecting', retry: { attempt: 2, maximum: 5 } }))
  })

  it('maps partial scale availability to a warning and disturbed readings to an error', () => {
    const partial = telemetry()
    partial.scales.lower = { ...partial.scales.lower, available: false, ready: false, stale: true, disconnected: true }
    const candidates = liveBrewNotificationCandidates({ active: true, availability: 'partial', connection: 'online', reconnectAttempt: 0, telemetry: { ...partial, measurement: { ...partial.measurement, state: 'DISTURBED_OR_UNCERTAIN' } }, machine, brewStatus: 'brewing', mode: 'device', prepStage: null, deviceBlocked: false, message: '' })
    expect(candidates).toContainEqual(expect.objectContaining({ key: 'scale-partial', severity: 'warning' }))
    expect(candidates).toContainEqual(expect.objectContaining({ key: 'measurement-disturbed', severity: 'error' }))
  })

  it('keeps the newest three cards and prefers removing an older non-error card', () => {
    const item = (id: string, severity: BrewNotificationSeverity) => ({ id, severity })
    const result = insertNotification([item('old-error', 'error'), item('old-status', 'status'), item('old-warning', 'warning')], item('new-error', 'error'))
    expect(result.map((value) => value.id)).toEqual(['new-error', 'old-error', 'old-status'])
  })

  it('uses an upward swipe threshold and limits notifications to brew context', () => {
    expect(shouldDismissForSwipe(-72, 300)).toBe(true)
    expect(shouldDismissForSwipe(-50, 300)).toBe(false)
    expect(isBrewNotificationContext(null, 'idle')).toBe(false)
    expect(isBrewNotificationContext('ready', 'preparing')).toBe(true)
  })
})
