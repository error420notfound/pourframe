export type ScaleId = 'upper' | 'lower'
export type TargetId = ScaleId | 'total'
export type DeviceCommand = 'tare' | 'calibrate' | 'set_target' | 'clear_target' | 'brew_step_cue' | 'brew_step_cue_cancel' | 'brew_step_activate' | 'brew_step_clear'
export type LedState = 'normal' | 'approaching' | 'at_target' | 'overweight'
export type MeasurementState = 'STABLE' | 'ACTIVE' | 'DRAWDOWN' | 'DISTURBED_OR_UNCERTAIN'
export type PairStatus = 'synchronized' | 'retained_peer' | 'unavailable'

export interface ScaleTelemetry {
  raw: number
  grams: number
  median_raw: number
  calibrated: number
  innovation_g: number
  filter_alpha: number
  filter_tau_s: number
  updated: boolean
  slope_g_s: number
  range_g: number
  available: boolean
  ready: boolean
  stale: boolean
  disconnected: boolean
  calibrating: boolean
  calibration_valid: boolean
  saturated: boolean
  cadence_valid: boolean
  last_sample_ms: number
  target_grams?: number | null
  target_history_grams?: number[]
}

export interface TotalTelemetry {
  grams: number | null
  available: boolean
  partial: boolean
  upper_included: boolean
  lower_included: boolean
  slope_g_s: number
  range_g: number
  pour_rate_g_s: number
  transfer_residual_g_s: number
  pair_status: PairStatus
  target_grams?: number | null
  target_history_grams?: number[]
  led_state: LedState
  led_proximity: number
}

export interface MeasurementTelemetry {
  seq: number
  new_snapshot: boolean
  sample_timestamp_ms: number
  upper_sample_timestamp_ms: number
  lower_sample_timestamp_ms: number
  state: MeasurementState
  candidate_state: MeasurementState
  is_stable: boolean
  confidence: number
  alpha: number
  sample_rate_hz: number
  upper_sample_rate_hz: number
  lower_sample_rate_hz: number
  pair_skew_us: number
  pair_tolerance_us: number
  pair_valid: boolean
  pair_status: PairStatus
  dropped_samples: number
  partial_samples: number
  upper_updated: boolean
  lower_updated: boolean
  upper_innovation_g: number
  lower_innovation_g: number
  upper_alpha: number
  lower_alpha: number
  upper_tau_s: number
  lower_tau_s: number
}

export interface DeviceTelemetry {
  v: 1
  type: 'telemetry'
  seq: number
  uptime_ms: number
  scales: Record<ScaleId, ScaleTelemetry>
  total: TotalTelemetry
  measurement: MeasurementTelemetry
  wifi: {
    connected: boolean
    provisioning: boolean
    ssid: string
    rssi: number
    ip: string
  }
  hostname: string
  led?: {
    cue_state: 'idle' | 'active' | 'completed' | 'cancelled' | 'health_aborted' | 'unavailable'
    cue_id: string
    cue_pulses_completed: number
  }
}

export type DeviceCommandPayload =
  | { command: 'tare' | 'calibrate' | 'set_target' | 'clear_target'; channel: TargetId; grams?: number }
  | { command: 'brew_step_cue'; cue_id: string; pulse_count: 5; interval_ms: 1000 }
  | { command: 'brew_step_cue_cancel'; cue_id: string }
  | { command: 'brew_step_activate'; transition_id: string; baseline_total_grams: number; step_target_grams: number; cumulative_target_grams: number }
  | { command: 'brew_step_clear' }

export interface ProtocolAck {
  v: 1
  type: 'ack'
  id: string
  ok: boolean
  message: string
}

export interface ProtocolError {
  v: 1
  type: 'error'
  id: string
  code: string
  message: string
}

export interface CalibrationEvent {
  v: 1
  type: 'calibration'
  channel: ScaleId
  ok: boolean
  factor?: number
}

export type ProtocolMessage = DeviceTelemetry | ProtocolAck | ProtocolError | CalibrationEvent
