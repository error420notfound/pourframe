export type ScaleId = 'upper' | 'lower'
export type TargetId = ScaleId | 'total'
export type DeviceCommand = 'tare' | 'calibrate' | 'set_target' | 'clear_target'
export type LedState = 'normal' | 'approaching' | 'at_target' | 'overweight'

export interface ScaleTelemetry {
  raw: number
  grams: number
  available: boolean
  ready: boolean
  stale: boolean
  disconnected: boolean
  calibrating: boolean
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
  target_grams?: number | null
  target_history_grams?: number[]
  led_state: LedState
  led_proximity: number
}

export interface DeviceTelemetry {
  v: 1
  type: 'telemetry'
  seq: number
  uptime_ms: number
  scales: Record<ScaleId, ScaleTelemetry>
  total: TotalTelemetry
  wifi: {
    connected: boolean
    provisioning: boolean
    ssid: string
    rssi: number
    ip: string
  }
  hostname: string
}

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
