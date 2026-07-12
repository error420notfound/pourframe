export type ScaleId = 'upper' | 'lower'

export interface ScaleTelemetry {
  raw: number
  grams: number
  available: boolean
  ready: boolean
  stale: boolean
  disconnected: boolean
  calibrating: boolean
  last_sample_ms: number
}

export interface DeviceTelemetry {
  v: 1
  type: 'telemetry'
  seq: number
  uptime_ms: number
  scales: Record<ScaleId, ScaleTelemetry>
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
