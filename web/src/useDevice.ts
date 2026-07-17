import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DeviceCommand,
  DeviceTelemetry,
  LedState,
  ProtocolAck,
  ProtocolError,
  ProtocolMessage,
  ScaleId,
  ScaleTelemetry,
  TargetId,
  TotalTelemetry,
} from './types'

type ConnectionState = 'connecting' | 'online' | 'offline'

interface PendingCommand {
  resolve: (ack: ProtocolAck) => void
  reject: (error: Error) => void
  timeout: number
}

const mockMode = import.meta.env.DEV && !import.meta.env.VITE_DEVICE_HOST
const targetToleranceGrams = 0.2
const approachFraction = 0.9

function usableScale(scale: ScaleTelemetry) {
  return scale.available && scale.ready && !scale.stale && !scale.disconnected && !scale.calibrating && Number.isFinite(scale.grams)
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
  const grams = available
    ? Math.round(((upperIncluded ? scales.upper.grams : 0) + (lowerIncluded ? scales.lower.grams : 0)) * 100) / 100
    : null
  return {
    grams,
    available,
    partial: upperIncluded !== lowerIncluded,
    upper_included: upperIncluded,
    lower_included: lowerIncluded,
    ...target,
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
    target_grams: 270,
    target_history_grams: [270, 300, 250],
    led_state: 'approaching',
    led_proximity: 0.81,
  },
  scales: {
    upper: {
      raw: 128_442,
      grams: 18.4,
      available: true,
      ready: true,
      stale: false,
      disconnected: false,
      calibrating: false,
      last_sample_ms: 119_920,
      target_grams: 20,
      target_history_grams: [20, 18, 22],
    },
    lower: {
      raw: 892_031,
      grams: 246.8,
      available: true,
      ready: true,
      stale: false,
      disconnected: false,
      calibrating: false,
      last_sample_ms: 119_920,
      target_grams: 250,
      target_history_grams: [250, 300, 200],
    },
  },
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
  const [telemetry, setTelemetry] = useState<DeviceTelemetry | null>(mockMode ? initialTelemetry : null)
  const [connection, setConnection] = useState<ConnectionState>(mockMode ? 'online' : 'connecting')
  const [lastUpdateAt, setLastUpdateAt] = useState<number>(mockMode ? Date.now() : 0)
  const [lastCalibration, setLastCalibration] = useState<{ channel: ScaleId; ok: boolean } | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const pendingRef = useRef(new Map<string, PendingCommand>())
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!mockMode) return
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000
      setTelemetry((current) => {
        if (!current) return initialTelemetry
        const scales = {
          upper: {
            ...current.scales.upper,
            raw: Math.round(128_442 + Math.sin(seconds * 3) * 8),
            grams: Math.round((current.scales.upper.grams + Math.sin(seconds * 2.5) * 0.02) * 100) / 100,
          },
          lower: {
            ...current.scales.lower,
            raw: Math.round(892_031 + Math.sin(seconds * 2.2) * 6),
            grams: Math.round((current.scales.lower.grams + Math.sin(seconds * 1.8) * 0.01) * 100) / 100,
          },
        }
        return {
          ...current,
          seq: current.seq + 1,
          uptime_ms: current.uptime_ms + 200,
          scales,
          total: deriveTotal(scales, current.total),
        }
      })
      setLastUpdateAt(Date.now())
    }, 200)
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
        setConnection('online')
      })
      socket.addEventListener('message', (event) => {
        let message: ProtocolMessage
        try {
          message = JSON.parse(event.data as string) as ProtocolMessage
        } catch {
          return
        }
        if (message.v !== 1) return
        if (message.type === 'telemetry') {
          setTelemetry(message)
          setLastUpdateAt(Date.now())
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
      socketRef.current?.close()
      for (const pending of pendingRef.current.values()) {
        window.clearTimeout(pending.timeout)
        pending.reject(new Error('Device connection closed'))
      }
      pendingRef.current.clear()
    }
  }, [])

  const sendCommand = useCallback((command: DeviceCommand, channel: TargetId, grams?: number) => {
    if (mockMode) {
      if (command === 'tare') {
        if (channel === 'total') return Promise.reject(new Error('Total weight cannot be tared directly'))
        setTelemetry((current) => {
          if (!current) return current
          const scales = { ...current.scales, [channel]: { ...current.scales[channel], grams: 0 } }
          return { ...current, scales, total: deriveTotal(scales, current.total) }
        })
      } else if (command === 'calibrate') {
        if (channel === 'total') return Promise.reject(new Error('Total weight cannot be calibrated directly'))
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
      } else if (command === 'set_target' && typeof grams === 'number') {
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
      } else if (command === 'clear_target') {
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
          command,
          channel,
          ...(command === 'calibrate' ? { known_grams: grams } : {}),
          ...(command === 'set_target' ? { target_grams: grams } : {}),
        }),
      )
    })
  }, [])

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

  return { telemetry, connection, lastUpdateAt, lastCalibration, sendCommand, saveWifi, mockMode }
}
