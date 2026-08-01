import { describe, expect, it } from 'vitest'
import type { DeviceTelemetry } from './types'
import { deriveDeviceAvailability } from './useDevice'

function telemetry(overrides: Partial<DeviceTelemetry> = {}): DeviceTelemetry {
  const scale = {
    raw: 1,
    grams: 10,
    median_raw: 1,
    calibrated: 10,
    innovation_g: 0,
    filter_alpha: 0.3,
    filter_tau_s: 0.25,
    updated: true,
    slope_g_s: 0,
    range_g: 0,
    available: true,
    ready: true,
    stale: false,
    disconnected: false,
    calibrating: false,
    calibration_valid: true,
    saturated: false,
    cadence_valid: true,
    last_sample_ms: 1000,
  }
  return {
    v: 1,
    type: 'telemetry',
    seq: 1,
    uptime_ms: 1000,
    hostname: 'pourframe.local',
    wifi: { connected: true, provisioning: false, ssid: 'Local', rssi: -50, ip: '192.168.1.2' },
    scales: { upper: { ...scale }, lower: { ...scale } },
    total: {
      grams: 20,
      available: true,
      partial: false,
      upper_included: true,
      lower_included: true,
      slope_g_s: 0,
      range_g: 0,
      pour_rate_g_s: 0,
      transfer_residual_g_s: 0,
      pair_status: 'synchronized',
      led_state: 'normal',
      led_proximity: 0,
    },
    measurement: {
      seq: 1,
      new_snapshot: true,
      sample_timestamp_ms: 1000,
      upper_sample_timestamp_ms: 1000,
      lower_sample_timestamp_ms: 1000,
      state: 'STABLE',
      candidate_state: 'STABLE',
      is_stable: true,
      confidence: 1,
      alpha: 0.3,
      sample_rate_hz: 10,
      upper_sample_rate_hz: 10,
      lower_sample_rate_hz: 10,
      pair_skew_us: 0,
      pair_tolerance_us: 60_000,
      pair_valid: true,
      pair_status: 'synchronized',
      dropped_samples: 0,
      partial_samples: 0,
      upper_updated: true,
      lower_updated: true,
      upper_innovation_g: 0,
      lower_innovation_g: 0,
      upper_alpha: 0.3,
      lower_alpha: 0.3,
      upper_tau_s: 0.25,
      lower_tau_s: 0.25,
    },
    ...overrides,
  }
}

describe('deriveDeviceAvailability', () => {
  const now = 10_000

  it('keeps initial and failed connections distinct from valid telemetry', () => {
    expect(deriveDeviceAvailability('connecting', null, 0, now)).toBe('connecting')
    expect(deriveDeviceAvailability('offline', null, 0, now)).toBe('offline')
  })

  it('requires fresh telemetry before reporting online', () => {
    expect(deriveDeviceAvailability('online', telemetry(), now - 100, now)).toBe('online')
    expect(deriveDeviceAvailability('online', telemetry(), now - 3000, now)).toBe('stale')
    expect(deriveDeviceAvailability('online', null, 0, now)).toBe('stale')
  })

  it('reports one unavailable scale as partial', () => {
    const value = telemetry()
    value.scales.lower = { ...value.scales.lower, available: false, ready: false, stale: true, disconnected: true }
    value.total = { ...value.total, partial: true, lower_included: false, grams: 10, pair_status: 'retained_peer' }
    expect(deriveDeviceAvailability('online', value, now - 100, now)).toBe('partial')
  })

  it('reports connected invalid paired telemetry as degraded', () => {
    const value = telemetry()
    value.measurement = { ...value.measurement, pair_valid: false, pair_status: 'unavailable' }
    expect(deriveDeviceAvailability('online', value, now - 100, now)).toBe('stale')
  })
})
