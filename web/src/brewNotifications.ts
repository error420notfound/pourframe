import { completePairedTelemetry, type BrewMachineState } from './brewMachine'
import type { BrewMode, BrewStatus } from './brewTypes'
import type { DeviceTelemetry, ScaleTelemetry } from './types'
import { maxReconnectAttempts, type ConnectionState, type DeviceAvailability } from './useDevice'

export type BrewNotificationSeverity = 'status' | 'warning' | 'error'
export type BrewNotificationIcon = 'refresh' | 'wifi-off' | 'badge-check' | 'alert' | 'scale' | 'timer-off' | 'pause' | 'archive'

export interface BrewNotificationCandidate {
  key: string
  severity: BrewNotificationSeverity
  icon: BrewNotificationIcon
  text: string
  retry?: { attempt: number; maximum: number }
  action?: 'reconnect' | 'import-legacy'
  persistent?: boolean
}

export interface LiveBrewNotificationState {
  active: boolean
  availability: DeviceAvailability
  connection: ConnectionState
  reconnectAttempt: number
  telemetry: DeviceTelemetry | null
  machine: BrewMachineState
  brewStatus: BrewStatus
  mode: BrewMode
  prepStage: 'confirm' | 'working' | 'ready' | 'timer' | null
  deviceBlocked: boolean
  message: string
}

function hardScaleFault(scale: ScaleTelemetry | undefined) {
  return Boolean(scale && !scale.calibrating && (!scale.calibration_valid || scale.saturated))
}

export function liveBrewNotificationCandidates(state: LiveBrewNotificationState): BrewNotificationCandidate[] {
  if (!state.active) return []

  const notifications: BrewNotificationCandidate[] = []
  const { telemetry } = state
  const upperFault = hardScaleFault(telemetry?.scales.upper)
  const lowerFault = hardScaleFault(telemetry?.scales.lower)

  if (state.availability === 'offline' && state.reconnectAttempt >= maxReconnectAttempts) {
    notifications.push({ key: 'device-offline', severity: 'error', icon: 'alert', text: 'PourFrame device offline', action: 'reconnect' })
  } else if (state.availability === 'offline') {
    notifications.push({ key: 'device-offline', severity: 'error', icon: 'alert', text: 'PourFrame device offline' })
  }

  if (state.reconnectAttempt > 0 && state.reconnectAttempt < maxReconnectAttempts && state.connection !== 'online') {
    notifications.push({ key: 'reconnecting', severity: 'status', icon: 'refresh', text: 'Reconnecting', retry: { attempt: state.reconnectAttempt, maximum: maxReconnectAttempts } })
  }
  if (state.availability === 'stale') notifications.push({ key: 'telemetry-stale', severity: 'warning', icon: 'wifi-off', text: 'Telemetry is stale' })
  if (state.availability === 'partial') notifications.push({ key: 'scale-partial', severity: 'warning', icon: 'scale', text: 'One scale is unavailable' })
  if (telemetry && !telemetry.wifi.connected) notifications.push({ key: 'wifi-disconnected', severity: 'status', icon: 'wifi-off', text: 'Wi-Fi disconnected' })
  if (upperFault || lowerFault) notifications.push({ key: 'scale-fault', severity: 'error', icon: 'scale', text: `${upperFault && lowerFault ? 'Both scales' : upperFault ? 'Upper scale' : 'Lower scale'} need attention` })
  if (telemetry?.measurement.state === 'DISTURBED_OR_UNCERTAIN' && state.brewStatus === 'brewing') notifications.push({ key: 'measurement-disturbed', severity: 'error', icon: 'alert', text: 'Scale measurement disturbed' })
  if (state.machine.phase === 'WAITING_FOR_STABLE_BASELINE' || (state.brewStatus === 'brewing' && state.mode === 'device' && telemetry && !completePairedTelemetry(telemetry))) {
    notifications.push({ key: 'waiting-for-scales', severity: 'status', icon: 'scale', text: 'Waiting for synchronized scales' })
  }
  if (state.deviceBlocked) notifications.push({ key: 'brew-paused-device', severity: 'error', icon: 'pause', text: 'Brew paused — device data lost' })
  if (state.mode === 'timer_only' && (state.brewStatus === 'brewing' || state.brewStatus === 'paused')) notifications.push({ key: 'timer-only', severity: 'status', icon: 'timer-off', text: 'Continuing timer-only' })
  if (state.deviceBlocked && state.connection === 'online' && telemetry && completePairedTelemetry(telemetry)) notifications.push({ key: 'device-recovered', severity: 'status', icon: 'badge-check', text: 'PourFrame reconnected' })
  if (state.prepStage === 'ready') notifications.push({ key: 'ready-to-prepare', severity: 'status', icon: 'badge-check', text: 'Ready to prepare' })
  if (state.machine.phase === 'ERROR') notifications.push({ key: 'brew-failed', severity: 'error', icon: 'alert', text: state.message || 'Brew failed' })

  return notifications
}

export function isBrewNotificationContext(prepStage: LiveBrewNotificationState['prepStage'], brewStatus: BrewStatus) {
  return prepStage != null || brewStatus === 'brewing' || brewStatus === 'paused'
}

export function insertNotification<T extends { id: string; severity: BrewNotificationSeverity }>(items: T[], next: T, protectedIds: readonly string[] = []) {
  const combined = [next, ...items]
  if (combined.length <= 3) return combined
  const protectedSet = new Set(protectedIds)
  const removable = combined.slice().reverse().find((item) => item.severity !== 'error' && !protectedSet.has(item.id))
    ?? combined.slice().reverse().find((item) => !protectedSet.has(item.id))
  return removable ? combined.filter((item) => item.id !== removable.id) : combined.slice(0, 3)
}

export function shouldDismissForSwipe(offsetY: number, cardHeight: number) {
  return offsetY <= -Math.min(72, Math.max(1, cardHeight) * 0.3)
}
