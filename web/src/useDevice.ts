import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DeviceCommand,
  DeviceCommandPayload,
  DeviceTelemetry,
  LedState,
  MeasurementState,
  ProtocolAck,
  ProtocolError,
  ProtocolMessage,
  ScaleId,
  ScaleTelemetry,
  TargetId,
  TotalTelemetry,
} from './types'

export type ConnectionState = 'connecting' | 'online' | 'offline'

interface PendingCommand {
  resolve: (ack: ProtocolAck) => void
  reject: (error: Error) => void
  timeout: number
}

const mockMode = import.meta.env.DEV && !import.meta.env.VITE_DEVICE_HOST
const mockScenario = mockMode && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mock') ?? 'healthy' : 'device'
const targetToleranceGrams = 0.2
const approachFraction = 0.9

export function usableScale(scale: ScaleTelemetry | undefined | null) {
  if (!scale) return false
  return scale.available && scale.ready && !scale.stale && !scale.disconnected && !scale.calibrating &&
    scale.calibration_valid && !scale.saturated && scale.cadence_valid && Number.isFinite(scale.grams)
}

export function validTelemetry(message: unknown): message is DeviceTelemetry {
  if (!message || typeof message !== 'object') return false
  const value = message as Partial<DeviceTelemetry>
  return value.v === 1 && value.type === 'telemetry' && typeof value.seq === 'number' &&
    typeof value.uptime_ms === 'number' && Boolean(value.scales?.upper) && Boolean(value.scales?.lower) &&
    Boolean(value.total) && Boolean(value.measurement) && typeof value.measurement?.confidence === 'number'
}

function evaluateTarget(grams: number | null, targetGrams: number | null | undefined) {
  let led_state: LedState = 'normal'
  let led_proximity = 0
  if (grams == null || targetGrams == null) return { led_state, led_proximity }

  const difference = grams - targetGrams
  if (difference > targetToleranceGrams) return { led_state: 'overweight' as const, led_proximity: 1 }
  if (Math.abs(difference) <= targetToleranceGrams) return { led_state: 'at_target' as const, led_proximity: 1 }

  const approachStart = targetGrams * approachFraction
  const approachEnd = targetGrams - targetToleranceGrams
  if (grams >= approachStart && grams < approachEnd) {
    const window = approachEnd - approachStart
    led_state = 'approaching'
    led_proximity = window > 0 ? Math.min(1, Math.max(0, (grams - approachStart) / window)) : 1
  }
  return { led_state, led_proximity }
}

function deriveTotal(scales: Record<ScaleId, ScaleTelemetry>, target: Pick<TotalTelemetry, 'target_grams' | 'target_history_grams'>): TotalTelemetry {
  const upperIncluded = usableScale(scales.upper)
  const lowerIncluded = usableScale(scales.lower)
  const available = upperIncluded || lowerIncluded
  const grams = available ? (upperIncluded ? scales.upper.grams : 0) + (lowerIncluded ? scales.lower.grams : 0) : null
  const pair_status = upperIncluded && lowerIncluded ? 'synchronized' : available ? 'retained_peer' : 'unavailable'
  return {
    target_grams: target.target_grams,
    target_history_grams: target.target_history_grams,
    grams,
    available,
    partial: upperIncluded !== lowerIncluded,
    upper_included: upperIncluded,
    lower_included: lowerIncluded,
    slope_g_s: scales.upper.slope_g_s + scales.lower.slope_g_s,
    range_g: Math.max(scales.upper.range_g, scales.lower.range_g),
    pour_rate_g_s: Math.max(0, scales.upper.slope_g_s + scales.lower.slope_g_s),
    transfer_residual_g_s: Math.abs(scales.upper.slope_g_s + scales.lower.slope_g_s),
    pair_status,
    ...evaluateTarget(grams, target.target_grams),
  }
}

const initialTelemetry: DeviceTelemetry = {
  v: 1,
  type: 'telemetry',
  seq: 1,
  uptime_ms: 120_000,
  hostname: 'pourframe.local',
  wifi: { connected: true, provisioning: false, ssid: 'Local Wi-Fi', rssi: -51, ip: '192.168.1.42' },
  total: {
    grams: 265.2,
    available: true,
    partial: false,
    upper_included: true,
    lower_included: true,
    slope_g_s: 0,
    range_g: 0.12,
    pour_rate_g_s: 0,
    transfer_residual_g_s: 0,
    pair_status: 'synchronized',
    target_grams: 270,
    target_history_grams: [270, 300, 250],
    led_state: 'approaching',
    led_proximity: 0.81,
  },
  measurement: {
    seq: 1200,
    new_snapshot: true,
    sample_timestamp_ms: 119_920,
    upper_sample_timestamp_ms: 119_920,
    lower_sample_timestamp_ms: 119_920,
    state: 'STABLE',
    candidate_state: 'STABLE',
    is_stable: true,
    confidence: 0.94,
    alpha: 0.329679954,
    sample_rate_hz: 10,
    upper_sample_rate_hz: 10,
    lower_sample_rate_hz: 10,
    pair_skew_us: 220,
    pair_tolerance_us: 60_000,
    pair_valid: true,
    pair_status: 'synchronized',
    dropped_samples: 0,
    partial_samples: 0,
    upper_updated: true,
    lower_updated: true,
    upper_innovation_g: 0.01,
    lower_innovation_g: 0.01,
    upper_alpha: 0.329679954,
    lower_alpha: 0.329679954,
    upper_tau_s: 0.25,
    lower_tau_s: 0.25,
  },
  scales: {
    upper: {
      raw: 128_442,
      grams: 18.4,
      median_raw: 128_442,
      calibrated: 18.4,
      innovation_g: 0.01,
      filter_alpha: 0.329679954,
      filter_tau_s: 0.25,
      updated: true,
      slope_g_s: 0,
      range_g: 0.08,
      available: true,
      ready: true,
      stale: false,
      disconnected: false,
      calibrating: false,
      calibration_valid: true,
      saturated: false,
      cadence_valid: true,
      last_sample_ms: 119_920,
      target_grams: 20,
      target_history_grams: [20, 18, 22],
    },
    lower: {
      raw: 892_031,
      grams: 246.8,
      median_raw: 892_031,
      calibrated: 246.8,
      innovation_g: 0.01,
      filter_alpha: 0.329679954,
      filter_tau_s: 0.25,
      updated: true,
      slope_g_s: 0,
      range_g: 0.09,
      available: true,
      ready: true,
      stale: false,
      disconnected: false,
      calibrating: false,
      calibration_valid: true,
      saturated: false,
      cadence_valid: true,
      last_sample_ms: 119_920,
      target_grams: 250,
      target_history_grams: [250, 300, 200],
    },
  },
}

function mockStateAt(seconds: number): {
  upper: number
  lower: number
  upperSlope: number
  lowerSlope: number
  state: MeasurementState
  confidence: number
  lowerFault: boolean
} {
  const phase = seconds % 20
  if (phase < 5) {
    return { upper: 18.4 + Math.sin(phase * 2.1) * 0.015, lower: 246.8 + Math.sin(phase * 1.7) * 0.015,
      upperSlope: 0, lowerSlope: 0, state: 'STABLE', confidence: 0.94, lowerFault: false }
  }
  if (phase < 9) {
    const elapsed = phase - 5
    return { upper: 18.4, lower: 246.8 + elapsed * 1.35, upperSlope: 0, lowerSlope: 1.35,
      state: 'ACTIVE', confidence: 0.9, lowerFault: false }
  }
  if (phase < 13) {
    const transfer = (phase - 9) * 0.32
    return { upper: 18.4 - transfer, lower: 252.2 + transfer, upperSlope: -0.32, lowerSlope: 0.32,
      state: 'DRAWDOWN', confidence: 0.91, lowerFault: false }
  }
  if (phase < 16) {
    const force = Math.sin((phase - 13) * 9) * 0.7
    return { upper: 17.12 + force, lower: 253.48 - force * 0.55, upperSlope: force * 3, lowerSlope: -force * 1.65,
      state: 'DISTURBED_OR_UNCERTAIN', confidence: 0.38, lowerFault: false }
  }
  if (phase < 18) {
    return { upper: 17.12, lower: 0, upperSlope: 0, lowerSlope: 0,
      state: 'DISTURBED_OR_UNCERTAIN', confidence: 0.3, lowerFault: true }
  }
  return { upper: 18.4, lower: 246.8, upperSlope: 0, lowerSlope: 0,
    state: 'STABLE', confidence: 0.94, lowerFault: false }
}

function mockTelemetryAt(elapsedMs: number, current: DeviceTelemetry): DeviceTelemetry {
  const seconds = elapsedMs / 1000
  const scenario = mockStateAt(seconds)
  const lastSampleMs = current.uptime_ms + 100
  const scales: Record<ScaleId, ScaleTelemetry> = {
    upper: {
      ...current.scales.upper,
      raw: Math.round(128_442 + (scenario.upper - 18.4) * 1024),
      median_raw: Math.round(128_442 + (scenario.upper - 18.4) * 1024),
      calibrated: scenario.upper,
      innovation_g: Math.abs(scenario.upper - current.scales.upper.grams),
      filter_alpha: 0.329679954,
      filter_tau_s: 0.25,
      updated: true,
      grams: scenario.upper,
      slope_g_s: scenario.upperSlope,
      range_g: scenario.state === 'STABLE' ? 0.08 : 0.7,
      last_sample_ms: lastSampleMs,
    },
    lower: {
      ...current.scales.lower,
      raw: Math.round(892_031 + (scenario.lower - 246.8) * 980),
      median_raw: Math.round(892_031 + (scenario.lower - 246.8) * 980),
      calibrated: scenario.lower,
      innovation_g: Math.abs(scenario.lower - current.scales.lower.grams),
      filter_alpha: scenario.lowerFault ? 0 : 0.329679954,
      filter_tau_s: 0.25,
      updated: !scenario.lowerFault,
      grams: scenario.lower,
      slope_g_s: scenario.lowerSlope,
      range_g: scenario.state === 'STABLE' ? 0.09 : 0.8,
      available: !scenario.lowerFault,
      ready: !scenario.lowerFault,
      stale: scenario.lowerFault,
      disconnected: scenario.lowerFault,
      last_sample_ms: scenario.lowerFault ? current.scales.lower.last_sample_ms : lastSampleMs,
    },
  }
  const total = deriveTotal(scales, current.total)
  total.transfer_residual_g_s = Math.abs(scenario.upperSlope + scenario.lowerSlope)
  total.pair_status = scenario.lowerFault ? 'retained_peer' : 'synchronized'
  return {
    ...current,
    seq: current.seq + 1,
    uptime_ms: current.uptime_ms + 100,
    scales,
    total,
    measurement: {
      seq: current.measurement.seq + 1,
      new_snapshot: true,
      sample_timestamp_ms: lastSampleMs,
      upper_sample_timestamp_ms: lastSampleMs,
      lower_sample_timestamp_ms: scenario.lowerFault ? current.measurement.lower_sample_timestamp_ms : lastSampleMs,
      state: scenario.state,
      candidate_state: scenario.state,
      is_stable: scenario.state === 'STABLE' && scenario.confidence >= 0.8,
      confidence: scenario.confidence,
      alpha: 0.329679954,
      sample_rate_hz: 10,
      upper_sample_rate_hz: 10,
      lower_sample_rate_hz: scenario.lowerFault ? 0 : 10,
      pair_skew_us: scenario.lowerFault ? 60_000 : 180 + Math.round(Math.abs(Math.sin(seconds)) * 100),
      pair_tolerance_us: 60_000,
      pair_valid: !scenario.lowerFault,
      pair_status: scenario.lowerFault ? 'retained_peer' : 'synchronized',
      dropped_samples: scenario.lowerFault ? current.measurement.dropped_samples + 1 : current.measurement.dropped_samples,
      partial_samples: scenario.lowerFault ? current.measurement.partial_samples + 1 : current.measurement.partial_samples,
      upper_updated: true,
      lower_updated: !scenario.lowerFault,
      upper_innovation_g: scales.upper.innovation_g,
      lower_innovation_g: scales.lower.innovation_g,
      upper_alpha: scales.upper.filter_alpha,
      lower_alpha: scales.lower.filter_alpha,
      upper_tau_s: 0.25,
      lower_tau_s: 0.25,
    },
  }
}

function socketUrl() {
  const configuredHost = import.meta.env.VITE_DEVICE_HOST as string | undefined
  if (configuredHost) {
    return `ws://${configuredHost}/ws`
  }
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/ws`
}

function requestId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function useDevice() {
  const [telemetry, setTelemetry] = useState<DeviceTelemetry | null>(mockMode && mockScenario !== 'disconnected' ? initialTelemetry : null)
  const [connection, setConnection] = useState<ConnectionState>(mockMode ? (mockScenario === 'disconnected' ? 'offline' : 'online') : 'connecting')
  const [lastUpdateAt, setLastUpdateAt] = useState<number>(mockMode ? Date.now() : 0)
  const [lastCalibration, setLastCalibration] = useState<{ channel: ScaleId; ok: boolean } | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const pendingRef = useRef(new Map<string, PendingCommand>())
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)
  const telemetryTimerRef = useRef<number | null>(null)
  const mockTaredRef = useRef<Record<ScaleId, boolean>>({ upper: false, lower: false })

  useEffect(() => {
    if (!mockMode || mockScenario === 'disconnected') return
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt
      setTelemetry((current) => {
        const next = mockTelemetryAt(elapsedMs, current ?? initialTelemetry)
        if (mockScenario === 'partial-upper') {
          next.scales.upper = { ...next.scales.upper, available: false, ready: false, stale: true, disconnected: true }
          next.total = deriveTotal(next.scales, next.total)
        } else if (mockScenario === 'partial-lower') {
          next.scales.lower = { ...next.scales.lower, available: false, ready: false, stale: true, disconnected: true }
          next.total = deriveTotal(next.scales, next.total)
        } else if (mockScenario === 'stale') {
          next.scales.upper = { ...next.scales.upper, ready: false, stale: true }
          next.scales.lower = { ...next.scales.lower, ready: false, stale: true }
          next.total = deriveTotal(next.scales, next.total)
        } else if (mockScenario === 'uncalibrated') {
          next.scales.upper = { ...next.scales.upper, calibration_valid: false }
          next.scales.lower = { ...next.scales.lower, calibration_valid: false }
          next.total = deriveTotal(next.scales, next.total)
        }
        if (mockTaredRef.current.upper) next.scales.upper = { ...next.scales.upper, grams: next.scales.upper.grams - 18.4, calibrated: next.scales.upper.calibrated - 18.4 }
        if (mockTaredRef.current.lower) next.scales.lower = { ...next.scales.lower, grams: next.scales.lower.grams - 246.8, calibrated: next.scales.lower.calibrated - 246.8 }
        next.total = deriveTotal(next.scales, next.total)
        return next
      })
      setLastUpdateAt(Date.now())
    }, 100)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (mockMode) return
    let disposed = false

    const connect = () => {
      if (disposed) return
      setConnection('connecting')
      const socket = new WebSocket(socketUrl())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        reconnectAttemptRef.current = 0
        setConnection('connecting')
        if (telemetryTimerRef.current !== null) window.clearTimeout(telemetryTimerRef.current)
        telemetryTimerRef.current = window.setTimeout(() => socket.close(), 3000)
      })
      socket.addEventListener('message', (event) => {
        let message: ProtocolMessage
        try {
          message = JSON.parse(event.data as string) as ProtocolMessage
        } catch {
          return
        }
        if (message.v !== 1) return
        if (message.type === 'telemetry' && validTelemetry(message)) {
          setTelemetry(message)
          setLastUpdateAt(Date.now())
          setConnection('online')
          if (telemetryTimerRef.current !== null) window.clearTimeout(telemetryTimerRef.current)
          telemetryTimerRef.current = window.setTimeout(() => socket.close(), 3000)
          return
        }
        if (message.type === 'calibration') {
          setLastCalibration({ channel: message.channel, ok: message.ok })
          return
        }
        if (message.type === 'ack' || message.type === 'error') {
          const pending = pendingRef.current.get(message.id)
          if (!pending) return
          window.clearTimeout(pending.timeout)
          pendingRef.current.delete(message.id)
          if (message.type === 'ack' && message.ok) {
            pending.resolve(message)
          } else {
            const detail = message as ProtocolError | ProtocolAck
            pending.reject(new Error(detail.message || 'Command failed'))
          }
        }
      })
      socket.addEventListener('close', () => {
        if (disposed) return
        if (telemetryTimerRef.current !== null) window.clearTimeout(telemetryTimerRef.current)
        telemetryTimerRef.current = null
        setConnection('offline')
        reconnectAttemptRef.current += 1
        const delay = Math.min(1000 * 2 ** (reconnectAttemptRef.current - 1), 10_000)
        reconnectTimerRef.current = window.setTimeout(connect, delay)
      })
      socket.addEventListener('error', () => socket.close())
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      if (telemetryTimerRef.current !== null) window.clearTimeout(telemetryTimerRef.current)
      socketRef.current?.close()
      for (const pending of pendingRef.current.values()) {
        window.clearTimeout(pending.timeout)
        pending.reject(new Error('Device connection closed'))
      }
      pendingRef.current.clear()
    }
  }, [])

  const sendProtocolCommand = useCallback((payload: DeviceCommandPayload) => {
    if (mockMode) {
      const command = payload.command
      const channel = 'channel' in payload ? payload.channel : undefined
      const grams = 'grams' in payload ? payload.grams : undefined
      if (mockScenario === 'command-failure') return Promise.reject(new Error('Mock device rejected the command'))
      if (command === 'tare') {
        if (!channel || channel === 'total') return Promise.reject(new Error('Total weight cannot be tared directly'))
        mockTaredRef.current[channel] = true
        setTelemetry((current) => {
          if (!current) return current
          const scales = { ...current.scales, [channel]: { ...current.scales[channel], grams: 0 } }
          return { ...current, scales, total: deriveTotal(scales, current.total) }
        })
      } else if (command === 'calibrate') {
        if (!channel || channel === 'total') return Promise.reject(new Error('Total weight cannot be calibrated directly'))
        setTelemetry((current) =>
          current
            ? {
                ...current,
                scales: { ...current.scales, [channel]: { ...current.scales[channel], calibrating: true } },
              }
            : current,
        )
        window.setTimeout(() => {
          setTelemetry((current) =>
            current
              ? {
                  ...current,
                  scales: { ...current.scales, [channel]: { ...current.scales[channel], calibrating: false } },
                }
              : current,
          )
          setLastCalibration({ channel, ok: true })
        }, 1200)
      } else if (command === 'set_target' && channel && typeof grams === 'number') {
        const rounded = Math.round(grams * 10) / 10
        setTelemetry((current) => {
          if (!current) return current
          if (channel === 'total') {
            const history = [rounded, ...(current.total.target_history_grams ?? []).filter((value) => value !== rounded)].slice(0, 5)
            return {
              ...current,
              total: deriveTotal(current.scales, { target_grams: rounded, target_history_grams: history }),
            }
          }
          const scale = current.scales[channel]
          const history = [rounded, ...(scale.target_history_grams ?? []).filter((value) => value !== rounded)].slice(0, 5)
          return {
            ...current,
            scales: {
              ...current.scales,
              [channel]: { ...scale, target_grams: rounded, target_history_grams: history },
            },
          }
        })
      } else if (command === 'clear_target' && channel) {
        setTelemetry((current) => {
          if (!current) return current
          if (channel === 'total') {
            return {
              ...current,
              total: deriveTotal(current.scales, { ...current.total, target_grams: null }),
            }
          }
          return {
            ...current,
            scales: {
              ...current.scales,
              [channel]: { ...current.scales[channel], target_grams: null },
            },
          }
        })
      }
      return Promise.resolve({ v: 1, type: 'ack', id: 'mock', ok: true, message: 'Accepted' } as ProtocolAck)
    }

    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Device is not connected'))
    }
    const id = requestId()
    return new Promise<ProtocolAck>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(id)
        reject(new Error('The device did not acknowledge the command'))
      }, 5000)
      pendingRef.current.set(id, { resolve, reject, timeout })
      socket.send(
        JSON.stringify({
          v: 1,
          type: 'command',
          id,
          ...payload,
          ...(payload.command === 'calibrate' ? { known_grams: payload.grams } : {}),
          ...(payload.command === 'set_target' ? { target_grams: payload.grams } : {}),
        }),
      )
    })
  }, [])

  const sendCommand = useCallback((command: DeviceCommand, channel: TargetId, grams?: number) => {
    if (command !== 'tare' && command !== 'calibrate' && command !== 'set_target' && command !== 'clear_target') return Promise.reject(new Error('Use sendProtocolCommand for brew commands'))
    return sendProtocolCommand({ command, channel, grams })
  }, [sendProtocolCommand])

  const saveWifi = useCallback(async (ssid: string, password: string) => {
    if (mockMode) {
      await new Promise((resolve) => window.setTimeout(resolve, 500))
      setTelemetry((current) =>
        current ? { ...current, wifi: { ...current.wifi, connected: true, ssid } } : current,
      )
      return
    }
    const response = await fetch('/api/wifi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ssid, password }),
    })
    if (!response.ok) throw new Error('The device could not save these Wi-Fi credentials')
  }, [])

  return { telemetry, connection, lastUpdateAt, lastCalibration, sendCommand, sendProtocolCommand, saveWifi, mockMode, mockScenario }
}
