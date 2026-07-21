import type { BrewMode, SensorSummary } from './brewTypes'
import type { DeviceTelemetry, ProtocolAck, ScaleId, TargetId } from './types'
import type { ConnectionState } from './useDevice'
import { usableScale } from './useDevice'
import { stablePairedTelemetry } from './brewMachine'

export interface PreparationResult { kind: 'ready' | 'timer'; message: string }
export type CommandSender = (command: 'tare' | 'set_target', channel: ScaleId | TargetId, grams?: number) => Promise<ProtocolAck>

export async function prepareDevice(connection: ConnectionState, telemetry: DeviceTelemetry | null, water: number, send: CommandSender): Promise<PreparationResult> {
  if (connection !== 'online') return { kind: 'timer', message: 'PourFrame is not connected.' }
  if (!telemetry) return { kind: 'timer', message: 'PourFrame has not published telemetry.' }
  if (!usableScale(telemetry.scales.upper)) return { kind: 'timer', message: 'Upper / dripper scale is unavailable, stale, uncalibrated, saturated, or has invalid cadence.' }
  if (!usableScale(telemetry.scales.lower)) return { kind: 'timer', message: 'Lower / carafe scale is unavailable, stale, uncalibrated, saturated, or has invalid cadence.' }
  if (!telemetry.measurement.pair_valid || telemetry.measurement.pair_status !== 'synchronized' || telemetry.total.partial) return { kind: 'timer', message: 'The two scale channels are not synchronized.' }
  if (!telemetry.measurement.is_stable || !stablePairedTelemetry(telemetry)) return { kind: 'timer', message: 'Waiting for both scales to become stable.' }
  try {
    await Promise.all([send('tare', 'upper'), send('tare', 'lower')])
    await send('set_target', 'total', water)
  } catch (error) {
    return { kind: 'timer', message: error instanceof Error ? error.message : 'PourFrame could not complete preparation.' }
  }
  return { kind: 'ready', message: 'Both scales tared and total-water target acknowledged.' }
}

export function newSensorSummary(mode: BrewMode): SensorSummary {
  return { mode, samples: 0, upper_available_frames: 0, lower_available_frames: 0, partial_frames: 0, confidence_min: null, confidence_mean: null, confidence_final: null, final_state: null, pair_status_counts: { synchronized: 0, retained_peer: 0, unavailable: 0 } }
}

export function addSensorSample(summary: SensorSummary, telemetry: DeviceTelemetry): SensorSummary {
  const samples = summary.samples + 1
  const confidence = telemetry.measurement.confidence
  const priorTotal = (summary.confidence_mean ?? 0) * summary.samples
  return {
    ...summary,
    samples,
    upper_available_frames: summary.upper_available_frames + (usableScale(telemetry.scales.upper) ? 1 : 0),
    lower_available_frames: summary.lower_available_frames + (usableScale(telemetry.scales.lower) ? 1 : 0),
    partial_frames: summary.partial_frames + (telemetry.total.partial ? 1 : 0),
    confidence_min: summary.confidence_min == null ? confidence : Math.min(summary.confidence_min, confidence),
    confidence_mean: (priorTotal + confidence) / samples,
    confidence_final: confidence,
    final_state: telemetry.measurement.state,
    pair_status_counts: { ...summary.pair_status_counts, [telemetry.measurement.pair_status]: summary.pair_status_counts[telemetry.measurement.pair_status] + 1 },
  }
}
