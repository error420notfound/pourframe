import type { DeviceTelemetry, ScaleTelemetry } from './types'

export const MAX_CAPTURE_SAMPLES = 100_000

export interface CaptureSample {
  elapsedSeconds: number
  telemetryUptimeMs: number
  telemetrySequence: number
  pipelineSequence: number
  newSnapshot: boolean
  measurementSampleMs: number
  upperSampleMs: number
  lowerSampleMs: number
  upperSampleRateHz: number
  lowerSampleRateHz: number
  pairValid: boolean
  pairStatus: DeviceTelemetry['measurement']['pair_status']
  pairSkewUs: number
  pairToleranceUs: number
  partialSamples: number
  droppedSamples: number
  upperCalibrated: number | null
  lowerCalibrated: number | null
  upperFiltered: number | null
  lowerFiltered: number | null
  totalFiltered: number | null
  upperInnovation: number
  lowerInnovation: number
  upperAlpha: number
  lowerAlpha: number
  upperTauSeconds: number
  lowerTauSeconds: number
  upperSlope: number
  lowerSlope: number
  totalSlope: number
  upperRange: number
  lowerRange: number
  totalRange: number
  upperUpdated: boolean
  lowerUpdated: boolean
  totalPartial: boolean
  candidateState: DeviceTelemetry['measurement']['candidate_state']
  committedState: DeviceTelemetry['measurement']['state']
  confidence: number
}

function finiteOrNull(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function usableScaleGrams(scale: ScaleTelemetry) {
  if (
    !scale.available ||
    !scale.ready ||
    scale.stale ||
    scale.disconnected ||
    scale.calibrating ||
    !scale.calibration_valid ||
    scale.saturated ||
    !scale.cadence_valid
  ) {
    return null
  }
  return finiteOrNull(scale.grams)
}

export function telemetryToCaptureSample(telemetry: DeviceTelemetry, firstTelemetryUptimeMs: number): CaptureSample {
  const measurement = telemetry.measurement
  return {
    elapsedSeconds: (telemetry.uptime_ms - firstTelemetryUptimeMs) / 1000,
    telemetryUptimeMs: telemetry.uptime_ms,
    telemetrySequence: telemetry.seq,
    pipelineSequence: measurement.seq,
    newSnapshot: measurement.new_snapshot,
    measurementSampleMs: measurement.sample_timestamp_ms,
    upperSampleMs: measurement.upper_sample_timestamp_ms,
    lowerSampleMs: measurement.lower_sample_timestamp_ms,
    upperSampleRateHz: measurement.upper_sample_rate_hz,
    lowerSampleRateHz: measurement.lower_sample_rate_hz,
    pairValid: measurement.pair_valid,
    pairStatus: measurement.pair_status,
    pairSkewUs: measurement.pair_skew_us,
    pairToleranceUs: measurement.pair_tolerance_us,
    partialSamples: measurement.partial_samples,
    droppedSamples: measurement.dropped_samples,
    upperCalibrated: finiteOrNull(telemetry.scales.upper.calibrated),
    lowerCalibrated: finiteOrNull(telemetry.scales.lower.calibrated),
    upperFiltered: usableScaleGrams(telemetry.scales.upper),
    lowerFiltered: usableScaleGrams(telemetry.scales.lower),
    totalFiltered: telemetry.total.available ? finiteOrNull(telemetry.total.grams) : null,
    upperInnovation: measurement.upper_innovation_g,
    lowerInnovation: measurement.lower_innovation_g,
    upperAlpha: measurement.upper_alpha,
    lowerAlpha: measurement.lower_alpha,
    upperTauSeconds: measurement.upper_tau_s,
    lowerTauSeconds: measurement.lower_tau_s,
    upperSlope: telemetry.scales.upper.slope_g_s,
    lowerSlope: telemetry.scales.lower.slope_g_s,
    totalSlope: telemetry.total.slope_g_s,
    upperRange: telemetry.scales.upper.range_g,
    lowerRange: telemetry.scales.lower.range_g,
    totalRange: telemetry.total.range_g,
    upperUpdated: measurement.upper_updated,
    lowerUpdated: measurement.lower_updated,
    totalPartial: telemetry.total.partial,
    candidateState: measurement.candidate_state,
    committedState: measurement.state,
    confidence: measurement.confidence,
  }
}

function csvCell(value: string | number | boolean | null) {
  if (value == null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function captureToCsv(samples: CaptureSample[]) {
  const rows: Array<Array<string | number | boolean | null>> = [
    [
      'elapsed_seconds',
      'telemetry_uptime_ms',
      'telemetry_sequence',
      'pipeline_sequence',
      'new_snapshot',
      'measurement_sample_ms',
      'upper_sample_ms',
      'lower_sample_ms',
      'upper_sample_rate_hz',
      'lower_sample_rate_hz',
      'pair_valid',
      'pair_status',
      'pair_skew_us',
      'pair_tolerance_us',
      'partial_samples',
      'dropped_samples',
      'upper_calibrated_g',
      'lower_calibrated_g',
      'upper_filtered_g',
      'lower_filtered_g',
      'total_filtered_g',
      'upper_innovation_g',
      'lower_innovation_g',
      'upper_alpha',
      'lower_alpha',
      'upper_tau_s',
      'lower_tau_s',
      'upper_slope_g_s',
      'lower_slope_g_s',
      'total_slope_g_s',
      'upper_range_g',
      'lower_range_g',
      'total_range_g',
      'upper_updated',
      'lower_updated',
      'total_partial',
      'candidate_state',
      'committed_state',
      'confidence',
    ],
  ]

  for (const sample of samples) {
    rows.push([
      sample.elapsedSeconds.toFixed(3),
      sample.telemetryUptimeMs,
      sample.telemetrySequence,
      sample.pipelineSequence,
      sample.newSnapshot,
      sample.measurementSampleMs,
      sample.upperSampleMs,
      sample.lowerSampleMs,
      sample.upperSampleRateHz,
      sample.lowerSampleRateHz,
      sample.pairValid,
      sample.pairStatus,
      sample.pairSkewUs,
      sample.pairToleranceUs,
      sample.partialSamples,
      sample.droppedSamples,
      sample.upperCalibrated,
      sample.lowerCalibrated,
      sample.upperFiltered,
      sample.lowerFiltered,
      sample.totalFiltered,
      sample.upperInnovation,
      sample.lowerInnovation,
      sample.upperAlpha,
      sample.lowerAlpha,
      sample.upperTauSeconds,
      sample.lowerTauSeconds,
      sample.upperSlope,
      sample.lowerSlope,
      sample.totalSlope,
      sample.upperRange,
      sample.lowerRange,
      sample.totalRange,
      sample.upperUpdated,
      sample.lowerUpdated,
      sample.totalPartial,
      sample.candidateState,
      sample.committedState,
      sample.confidence,
    ])
  }

  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function pad(value: number) {
  return value.toString().padStart(2, '0')
}

export function captureFilename(startedAt: Date) {
  const date = `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}`
  const time = `${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}`
  return `pourframe-capture-${date}-${time}.csv`
}
