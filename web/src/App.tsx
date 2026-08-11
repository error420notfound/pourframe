import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { ArrowDownTrayIcon as Download, ArrowPathIcon as RefreshCw, ArrowUturnLeftIcon as RotateCcw, ArrowUpTrayIcon as FileUp, ArrowsPointingInIcon as Minimize2, ArrowsPointingOutIcon as Maximize2, BeakerIcon as Coffee, BookOpenIcon as BookOpen, BookmarkSquareIcon as Save, CheckCircleIcon as CheckCircle2, ChevronRightIcon as ChevronRight, ClockIcon as Clock3, ClockIcon as History, Cog6ToothIcon as Settings, MoonIcon as Moon, PauseIcon as Pause, PencilIcon as Pencil, PlayIcon as Play, ScaleIcon as Scale, SpeakerWaveIcon as Volume2, SpeakerXMarkIcon as VolumeX, StarIcon as Star, StopIcon as Square, SunIcon as Sun, TrashIcon as Trash2 } from '@heroicons/react/24/solid'
import { createPortal } from 'react-dom'
import { ActiveBrewSummary } from './ActiveBrewSummary'
import { setAudioEnabled } from './audio'
import { buildSchedule, createId, expectedRecipeYield, formatRecipeInput, formatRecipeWeight, formatTime, migrateRecipe, normalizeRecipe, updateRecipeNumber, validateRecipe } from './brew'
import { BrewGraph, brewMilestones, scheduledBrewMilestones } from './BrewGraph'
import { completePairedTelemetry, liveScaleTelemetry, type BrewMachineState } from './brewMachine'
import { BrewSelectionSheet } from './BrewSelectionSheet'
import { tareBothScales } from './brewSession'
import type { BrewMode, BrewRecipe, BrewRecord, BrewStatus, CoffeeBag as CoffeeBagRecord } from './brewTypes'
import { CoffeeBagWorkspace } from './CoffeeBagWorkspace'
import { defaultRecipes } from './defaultRecipes'
import { loadBrewTrace, useLibrary } from './library'
import { appHash, parseAppHash } from './navigation'
import { usePwaInstall } from './pwa'
import type { BrewTraceBuffer, BrewTraceSample } from './trace'
import type { DeviceTelemetry, MeasurementTelemetry, ScaleId, ScaleTelemetry, TargetId, TotalTelemetry } from './types'
import { usableScale, useDevice, type BrowserNetworkState, type ConnectionState, type DeviceAvailability } from './useDevice'
import { useGuidedBrew } from './useGuidedBrew'
import { Button, EmptyState, LibraryItemCard, Modal, PageHeader, SectionHeader } from './ui'
import { WeightCapture } from './WeightCapture'

interface ScalePanelProps {
  id: ScaleId
  label: string
  scale: ScaleTelemetry | null
  measurement: MeasurementTelemetry | null
  onTare: (id: ScaleId) => Promise<void>
  onCalibrate: (id: ScaleId) => void
  commandsEnabled: boolean
}

function TickRail() {
  return (
    <div className="tick-rail" aria-hidden="true">
      {Array.from({ length: 11 }, (_, index) => (
        <span className={index === 5 ? 'tick tick--active' : 'tick'} key={index} />
      ))}
    </div>
  )
}

function formatWeight(value: number) {
  const rounded = Math.round(value * 10) / 10
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1)
}

interface DualTareControl {
  tareBoth: () => Promise<void>
  busy: boolean
  enabled: boolean
  message: string
}

function useDualTare(sendCommand: ReturnType<typeof useDevice>['sendCommand'], enabled: boolean): DualTareControl {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const busyRef = useRef(false)
  const tareBoth = useCallback(async () => {
    if (!enabled || busyRef.current) return
    busyRef.current = true; setBusy(true); setMessage('Taring both scales…')
    const result = await tareBothScales(sendCommand)
    const failed: string[] = []
    if (!result.upper) failed.push('upper')
    if (!result.lower) failed.push('lower')
    if (!failed.length) setMessage('Both scales tared')
    else {
      const succeeded = ['upper', 'lower'].filter((name) => !failed.includes(name))
      setMessage(`${failed.map((name) => `${name[0].toUpperCase()}${name.slice(1)} failed`).join(' and ')}${succeeded.length ? `; ${succeeded.join(' and ')} tared` : ''}.`)
    }
    busyRef.current = false; setBusy(false)
  }, [enabled, sendCommand])
  return { tareBoth, busy, enabled, message }
}

function MeasurementLine({ measurement, fault }: { measurement: MeasurementTelemetry | null; fault: boolean }) {
  const state = fault ? 'DISTURBED_OR_UNCERTAIN' : measurement?.state ?? 'DISTURBED_OR_UNCERTAIN'
  const label = state === 'DISTURBED_OR_UNCERTAIN' ? 'Uncertain' : state.charAt(0) + state.slice(1).toLowerCase()
  return (
    <div className={`measurement-line measurement-line--${state.toLowerCase()}`}>
      <svg viewBox="0 0 500 20" preserveAspectRatio="none">
        <path d="M1 10h255l7-3 9 6 8-5 9 4 8-6 8 7 8-5 8 4 8-7 8 7 9-4 8 2 8-5 9 7 8-6 9 8 7-5 9 2 8-6 8 8 8-4 8 3 8-5 8 5h25" />
      </svg>
      <span>{label}</span>
    </div>
  )
}

interface TargetControlProps {
  id: TargetId
  label: string
  targetGrams?: number | null
  history?: number[]
  primary?: boolean
  disabled?: boolean
  onSetTarget: (id: TargetId, grams: number) => Promise<void>
  onClearTarget: (id: TargetId) => Promise<void>
}

function TargetControl({ id, label, targetGrams, history, primary = false, disabled = false, onSetTarget, onClearTarget }: TargetControlProps) {
  const [actionMessage, setActionMessage] = useState('')
  const [targetInput, setTargetInput] = useState(() => targetGrams?.toFixed(1) ?? '')
  const [targetSaving, setTargetSaving] = useState(false)

  useEffect(() => {
    setTargetInput(targetGrams?.toFixed(1) ?? '')
  }, [targetGrams])

  const saveTarget = async (event: FormEvent) => {
    event.preventDefault()
    const grams = Number(targetInput)
    if (!Number.isFinite(grams) || grams <= 0) {
      setActionMessage('Enter a positive target weight.')
      return
    }
    setTargetSaving(true)
    setActionMessage('Saving target…')
    try {
      await onSetTarget(id, grams)
      setActionMessage(`Target set to ${Math.round(grams * 10) / 10} g`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Target could not be saved')
    } finally {
      setTargetSaving(false)
    }
  }

  const clearTarget = async () => {
    setTargetSaving(true)
    setActionMessage('Clearing target…')
    try {
      await onClearTarget(id)
      setActionMessage('Target cleared')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Target could not be cleared')
    } finally {
      setTargetSaving(false)
    }
  }

  const selectRecentTarget = async (grams: number) => {
    setTargetInput(grams.toFixed(1))
    setTargetSaving(true)
    setActionMessage(`Selecting ${grams.toFixed(1)} g…`)
    try {
      await onSetTarget(id, grams)
      setActionMessage(`Target set to ${grams.toFixed(1)} g`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Target could not be selected')
    } finally {
      setTargetSaving(false)
    }
  }

  return (
    <form className={primary ? 'target-control target-control--primary' : 'target-control'} onSubmit={saveTarget}>
      <div className="target-control__heading">
        <label htmlFor={`${id}-target`}>{label}</label>
        <span>{targetGrams == null ? 'Not set' : `${targetGrams.toFixed(1)} g active`}</span>
      </div>
      <div className="target-control__entry">
        <div className="target-control__input">
          <input
            id={`${id}-target`}
            disabled={disabled}
            inputMode="decimal"
            min="0.1"
            onChange={(event) => setTargetInput(event.target.value)}
            placeholder="0.0"
            step="0.1"
            type="number"
            value={targetInput}
          />
          <span>g</span>
        </div>
        <button className="target-button target-button--save" disabled={disabled || targetSaving} type="submit">
          {targetSaving ? 'Saving…' : 'Save'}
        </button>
        <button className="target-button" disabled={disabled || targetSaving || targetGrams == null} onClick={clearTarget} type="button">
          Clear
        </button>
      </div>
      {history?.length ? (
        <div className="target-history" aria-label={`Recent ${label.toLowerCase()} values`}>
          <span>Recent</span>
          {history.map((grams) => (
            <button
              className={targetGrams === grams ? 'target-chip target-chip--active' : 'target-chip'}
              disabled={disabled || targetSaving}
              key={grams}
              onClick={() => selectRecentTarget(grams)}
              type="button"
            >
              {grams.toFixed(1)} g
            </button>
          ))}
        </div>
      ) : null}
      <p className="target-message" role="status">{actionMessage}</p>
    </form>
  )
}

function ScalePanel({ id, label, scale, measurement, onTare, onCalibrate, commandsEnabled }: ScalePanelProps) {
  const [actionMessage, setActionMessage] = useState('')
  const unavailable = !scale || scale.disconnected || !scale.calibration_valid
  const weight = unavailable ? '—' : formatWeight(scale.grams)
  const raw = scale?.available === false || !scale ? 'Unavailable' : scale.raw.toLocaleString('en-US')

  const tare = async () => {
    setActionMessage('Taring…')
    try {
      await onTare(id)
      setActionMessage('Tared')
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Tare failed')
    }
  }

  return (
    <section className="scale-panel" aria-labelledby={`${id}-heading`}>
      <TickRail />
      <div className="scale-panel__content">
        <h2 className="metric-title metric-title--panel" id={`${id}-heading`}>{label}</h2>
        <div className={unavailable ? 'weight weight--unavailable' : 'weight'} aria-live="polite">
          <span>{weight}</span>
          {!unavailable ? <small>g</small> : null}
        </div>
        <MeasurementLine measurement={measurement} fault={unavailable || Boolean(scale?.stale || scale?.saturated)} />
        <p className="raw-reading">
          <span>Raw</span> {raw}
        </p>
        <div className="scale-actions">
          <Button disabled={!commandsEnabled || unavailable || scale?.calibrating} onClick={tare} surface="device">
            Tare
          </Button>
          <Button disabled={!commandsEnabled || unavailable || scale?.calibrating} onClick={() => onCalibrate(id)} surface="device" variant="secondary">
            {scale?.calibrating ? 'Calibrating…' : 'Calibrate'}
          </Button>
        </div>
        <p className="action-message" role="status">{actionMessage}</p>
      </div>
    </section>
  )
}

interface TotalWeightSectionProps {
  total: TotalTelemetry | null
  upper: ScaleTelemetry | null
  lower: ScaleTelemetry | null
  measurement: MeasurementTelemetry | null
  onSetTarget: (id: TargetId, grams: number) => Promise<void>
  onClearTarget: (id: TargetId) => Promise<void>
  dualTare: DualTareControl
  commandsEnabled: boolean
}

function TotalWeightSection({ total, upper, lower, measurement, onSetTarget, onClearTarget, dualTare, commandsEnabled }: TotalWeightSectionProps) {
  const targetGrams = total?.target_grams
  const liveGrams = total?.grams
  const hasReading = Boolean(total?.available && liveGrams != null)
  const hasProgress = hasReading && targetGrams != null
  const percentage = hasProgress ? Math.min(100, Math.max(0, (liveGrams! / targetGrams) * 100)) : 0
  const approachDuration = 1000 - Math.min(1, Math.max(0, total?.led_proximity ?? 0)) * 800
  const progressStyle = {
    '--progress': `${percentage}%`,
    '--approach-duration': `${approachDuration}ms`,
  } as CSSProperties
  const sourceLabel = !total?.available
    ? 'No usable load cells'
    : total.partial
      ? total.upper_included
        ? 'Partial · Upper only'
        : 'Partial · Lower only'
      : 'Upper + lower load cells'
  const progressLabel = !targetGrams
    ? 'Set a total target to track progress'
    : !hasReading
      ? 'Waiting for a usable reading'
      : `${percentage.toFixed(0)}% of ${targetGrams.toFixed(1)} g target`
  const state = total?.led_state ?? 'normal'
  const stateLabel = !targetGrams
    ? 'No target set'
    : !hasReading
      ? 'Waiting for reading'
      : state === 'at_target'
        ? 'At target'
        : state === 'overweight'
          ? 'Overweight'
          : state === 'approaching'
            ? 'Approaching target'
            : 'Below target'

  return (
    <section className="total-weight" aria-labelledby="total-weight-heading">
      <div className="total-weight__summary" style={progressStyle}>
        <div className="total-weight__heading">
          <div>
            <p className="eyebrow">Combined measurement</p>
            <h2 className="metric-title metric-title--summary" id="total-weight-heading">Total Weight</h2>
          </div>
          <span className={total?.partial ? 'total-source total-source--partial' : 'total-source'}>{sourceLabel}</span>
        </div>
        <div className="total-tare">
          <Button disabled={!dualTare.enabled || dualTare.busy} onClick={() => void dualTare.tareBoth()} surface="device" type="button">
            {dualTare.busy ? 'Taring both…' : 'Tare both scales'}
          </Button>
          <span role="status">{dualTare.message}</span>
        </div>
        <div className={hasReading ? 'total-weight__value' : 'total-weight__value total-weight__value--unavailable'} aria-live="polite">
          <span>{hasReading ? formatWeight(liveGrams!) : '—'}</span>
          {hasReading ? <small>g</small> : null}
        </div>
        <div className="progress-copy">
          <span>{progressLabel}</span>
          {hasProgress ? <strong>{formatWeight(liveGrams!)} / {targetGrams.toFixed(1)} g</strong> : null}
        </div>
        <div
          aria-label="Total weight progress"
          aria-valuemax={hasProgress ? targetGrams : undefined}
          aria-valuemin={hasProgress ? 0 : undefined}
          aria-valuenow={hasProgress ? Math.min(targetGrams, Math.max(0, liveGrams!)) : undefined}
          aria-valuetext={hasProgress ? progressLabel : undefined}
          className="total-progress"
          role={hasProgress ? 'progressbar' : undefined}
        >
          <span className={`total-progress__fill total-progress__fill--${state}`} />
        </div>
        <div className="led-legend" aria-label={`LED state: ${stateLabel}`}>
          <i className={`led-legend__dot led-legend__dot--${state}`} />
          <span>{stateLabel}</span>
        </div>
        <div className={`measurement-summary measurement-summary--${(measurement?.state ?? 'DISTURBED_OR_UNCERTAIN').toLowerCase()}`}>
          <strong>{measurement?.state === 'DISTURBED_OR_UNCERTAIN' ? 'Uncertain' : measurement?.state ?? 'Waiting'}</strong>
          <span>{measurement ? `${Math.round(measurement.confidence * 100)}% confidence${measurement.is_stable ? ' · stable' : ''}` : 'No measurement state'}</span>
        </div>
      </div>

      <div className="total-weight__controls">
        <TargetControl
          disabled={!commandsEnabled}
          history={total?.target_history_grams}
          id="total"
          label="Total target weight"
          onClearTarget={onClearTarget}
          onSetTarget={onSetTarget}
          primary
          targetGrams={targetGrams}
        />
      </div>

      <details className="advanced-targets">
        <summary>Advanced per-scale targets</summary>
        <p>Legacy targets remain available for compatible clients. They do not control the total progress indicator or status LED.</p>
        <div className="advanced-targets__grid">
          <TargetControl
            disabled={!commandsEnabled}
            history={upper?.target_history_grams}
            id="upper"
            label="Upper target"
            onClearTarget={onClearTarget}
            onSetTarget={onSetTarget}
            targetGrams={upper?.target_grams}
          />
          <TargetControl
            disabled={!commandsEnabled}
            history={lower?.target_history_grams}
            id="lower"
            label="Lower target"
            onClearTarget={onClearTarget}
            onSetTarget={onSetTarget}
            targetGrams={lower?.target_grams}
          />
        </div>
      </details>
    </section>
  )
}

interface CalibrationModalProps {
  channel: ScaleId
  onClose: () => void
  onSubmit: (knownGrams: number) => Promise<void>
}

type CalibrationUnit = 'g' | 'kg'

function CalibrationModal({ channel, onClose, onSubmit }: CalibrationModalProps) {
  const [knownWeight, setKnownWeight] = useState('100')
  const [unit, setUnit] = useState<CalibrationUnit>('g')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = Number(knownWeight)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a positive reference weight.')
      return
    }
    const knownGrams = unit === 'kg' ? value * 1000 : value
    setSubmitting(true)
    setError('')
    try {
      await onSubmit(knownGrams)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Calibration could not start.')
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Calibrate ${channel === 'upper' ? 'Upper / Dripper' : 'Lower / Carafe'}`} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p>Tare the empty platform first, place a known weight, then keep it still during the one-second calibration capture.</p>
        <label htmlFor="known-weight">Known weight</label>
        <div className="input-with-unit">
          <input
            autoFocus
            id="known-weight"
            min="0.1"
            onChange={(event) => setKnownWeight(event.target.value)}
            step="0.1"
            type="number"
            value={knownWeight}
          />
          <select
            aria-label="Reference weight unit"
            onChange={(event) => setUnit(event.target.value as CalibrationUnit)}
            value={unit}
          >
            <option value="g">g</option>
            <option value="kg">kg</option>
          </select>
        </div>
        <small className="form-hint">For example: enter 1000 g or 1 kg for a one-kilogram reference.</small>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <Button disabled={submitting} fullWidth surface="device" type="submit">
          {submitting ? 'Starting…' : 'Start calibration'}
        </Button>
      </form>
    </Modal>
  )
}

interface SettingsModalProps {
  currentSsid: string
  onClose: () => void
  onSaveWifi: (ssid: string, password: string) => Promise<void>
}

function SettingsModal({ currentSsid, onClose, onSaveWifi }: SettingsModalProps) {
  const [ssid, setSsid] = useState(currentSsid)
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setStatus('Saving…')
    try {
      await onSaveWifi(ssid.trim(), password)
      setStatus('Credentials saved. The device is connecting now.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not save Wi-Fi credentials.')
    }
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p>Connect Pourframe to the same local Wi-Fi as this phone or computer.</p>
        <label htmlFor="wifi-ssid">Wi-Fi name</label>
        <input autoFocus id="wifi-ssid" maxLength={32} onChange={(event) => setSsid(event.target.value)} required value={ssid} />
        <label htmlFor="wifi-password">Password</label>
        <input id="wifi-password" maxLength={64} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        {status ? <p className="form-status" role="status">{status}</p> : null}
        <Button fullWidth surface="device" type="submit">Save Wi-Fi</Button>
      </form>
    </Modal>
  )
}

function HealthItem({ label, value, healthy, clock = false }: { label: string; value: string; healthy: boolean; clock?: boolean }) {
  const Icon = clock ? Clock3 : CheckCircle2
  return (
    <div className={healthy ? 'health-item health-item--ok' : 'health-item health-item--error'}>
      <Icon />
      <p><span>{label}</span><strong>{value}</strong></p>
    </div>
  )
}

interface DeviceWorkspaceProps {
  telemetry: DeviceTelemetry | null
  connection: ConnectionState
  availability: DeviceAvailability
  lastUpdateAt: number
  mockMode: boolean
  sendCommand: ReturnType<typeof useDevice>['sendCommand']
  saveWifi: ReturnType<typeof useDevice>['saveWifi']
  dualTare: DualTareControl
}

function DeviceWorkspace({ telemetry, connection, availability, lastUpdateAt, sendCommand, saveWifi, mockMode, dualTare }: DeviceWorkspaceProps) {
  const [calibrationChannel, setCalibrationChannel] = useState<ScaleId | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const updateAge = lastUpdateAt ? Math.max(0, now - lastUpdateAt) : 0
  const commandsEnabled = availability === 'online' || availability === 'partial'
  const online = commandsEnabled && updateAge < 1500
  const lastUpdate = useMemo(() => {
    if (!lastUpdateAt) return 'Waiting for data'
    if (updateAge < 1000) return `${Math.max(1, Math.round(updateAge))} ms ago`
    return `${Math.round(updateAge / 100) / 10} s ago`
  }, [lastUpdateAt, updateAge])

  const tare = (channel: ScaleId) => sendCommand('tare', channel).then(() => undefined)
  const calibrate = (channel: ScaleId, knownGrams: number) =>
    sendCommand('calibrate', channel, knownGrams).then(() => undefined)
  const setTarget = (channel: TargetId, targetGrams: number) =>
    sendCommand('set_target', channel, targetGrams).then(() => undefined)
  const clearTarget = (channel: TargetId) => sendCommand('clear_target', channel).then(() => undefined)

  const upper = telemetry?.scales.upper ?? null
  const lower = telemetry?.scales.lower ?? null
  const total = telemetry?.total ?? null
  const wifiConnected = Boolean(telemetry?.wifi.connected)

  return (
    <div className="device-workspace">
      <PageHeader
        actions={<div className="header-status">
          <span className="hostname">pourframe.local</span>
          <span className={online ? 'connection connection--online' : 'connection connection--offline'}><i /> {availability === 'partial' ? 'One scale unavailable' : online ? 'Device online' : connection === 'connecting' ? 'Connecting' : availability === 'stale' ? 'Telemetry degraded' : 'Device offline'}</span>
          <button className="settings-button" disabled={!commandsEnabled} onClick={() => setSettingsOpen(true)}><Settings /> Wi-Fi</button>
        </div>}
        className="device-workspace__heading device-workspace__header"
        eyebrow="Device"
        title="Scale and connectivity"
        variant="compact"
      />
      <TotalWeightSection
        commandsEnabled={commandsEnabled}
        dualTare={dualTare}
        lower={lower}
        measurement={telemetry?.measurement ?? null}
        onClearTarget={clearTarget}
        onSetTarget={setTarget}
        total={total}
        upper={upper}
      />

      <WeightCapture online={online} telemetry={telemetry} />

      <div className="scale-grid">
        <ScalePanel
          commandsEnabled={commandsEnabled}
          id="upper"
          label="Upper / Dripper"
          measurement={telemetry?.measurement ?? null}
          onCalibrate={setCalibrationChannel}
          onTare={tare}
          scale={upper}
        />
        <ScalePanel
          commandsEnabled={commandsEnabled}
          id="lower"
          label="Lower / Carafe"
          measurement={telemetry?.measurement ?? null}
          onCalibrate={setCalibrationChannel}
          onTare={tare}
          scale={lower}
        />
      </div>

      <section className="health-rail" aria-label="Device status">
        <HealthItem healthy={Boolean(upper?.ready && upper.calibration_valid && !upper.saturated)} label="Upper HX711" value={!upper?.calibration_valid ? 'Calibration required' : upper?.ready ? 'Ready' : 'Unavailable'} />
        <HealthItem healthy={Boolean(lower?.ready && lower.calibration_valid && !lower.saturated)} label="Lower HX711" value={!lower?.calibration_valid ? 'Calibration required' : lower?.ready ? 'Ready' : 'Unavailable'} />
        <HealthItem healthy={wifiConnected} label="Wi-Fi" value={wifiConnected ? 'Connected' : 'Setup required'} />
        <HealthItem clock healthy={online} label="Last update" value={lastUpdate} />
      </section>

      {mockMode ? <p className="mock-note">Development mock telemetry is active.</p> : null}

      {calibrationChannel ? (
        <CalibrationModal
          channel={calibrationChannel}
          onClose={() => setCalibrationChannel(null)}
          onSubmit={(knownGrams) => calibrate(calibrationChannel, knownGrams)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          currentSsid={telemetry?.wifi.ssid ?? ''}
          onClose={() => setSettingsOpen(false)}
          onSaveWifi={saveWifi}
        />
      ) : null}
    </div>
  )
}

function storedValue(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}

function storeValue(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* preference remains in memory */ }
}

type ThemePreference = 'system' | 'light' | 'dark'

const themePreferenceKey = 'pourframe.theme.preference.v1'

function readThemePreference(): ThemePreference {
  const stored = storedValue(themePreferenceKey)
  if (stored === 'system' || stored === 'light' || stored === 'dark') return stored

  // The old key was written as "light" on every first load, even without a
  // user choice. Preserve an explicit old dark choice, but let old light
  // values fall back to the new system default.
  return storedValue('pourframe.theme') === 'dark' ? 'dark' : 'system'
}

function useSystemDarkMode() {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)

  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mediaQuery) return

    const sync = () => setSystemDark(mediaQuery.matches)
    sync()
    mediaQuery.addEventListener?.('change', sync)
    return () => mediaQuery.removeEventListener?.('change', sync)
  }, [])

  return systemDark
}

function useFullscreenWakeLock(active: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    let disposed = false

    const release = () => {
      const sentinel = wakeLockRef.current
      wakeLockRef.current = null
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined)
    }

    const request = async () => {
      if (disposed || !active || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return
      if (wakeLockRef.current && !wakeLockRef.current.released) return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (disposed) {
          void sentinel.release().catch(() => undefined)
          return
        }
        wakeLockRef.current = sentinel
        sentinel.addEventListener('release', () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null
        })
      } catch {
        // Wake Lock is an enhancement; fullscreen remains usable when unavailable.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void request()
      else release()
    }

    if (active) {
      void request()
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      release()
    }
  }, [active])
}

type PrepStage = 'confirm' | 'working' | 'ready' | 'timer'

interface PreparationModalProps {
  stage: PrepStage
  message: string
  recipe: BrewRecipe
  coffeeBag: CoffeeBagRecord | null
  usableUpper: boolean
  usableLower: boolean
  onClose: () => void
  onPrepare: () => void
  onStart: () => void
  onStartTimer: () => void
}

function PreparationFocus({ stage, message, recipe, coffeeBag, usableUpper, usableLower, onClose, onPrepare, onStart, onStartTimer, fullscreenActive, dark, traceBuffer, milestones }: PreparationModalProps & { fullscreenActive: boolean; dark: boolean; traceBuffer: BrewTraceBuffer; milestones: ReturnType<typeof brewMilestones> }) {
  const [coffeeReady, setCoffeeReady] = useState(false)
  const [carafeReady, setCarafeReady] = useState(false)
  const [lowStockConfirmed, setLowStockConfirmed] = useState(false)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const fullscreenWasActiveRef = useRef(Boolean(document.fullscreenElement))
  const lowStock = Boolean(coffeeBag && coffeeBag.remainingWeightG < recipe.coffee)
  const canExit = stage !== 'working'
  const exit = useCallback(() => {
    if (!canExit) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    onClose()
  }, [canExit, onClose])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const htmlHadFocusClass = document.documentElement.classList.contains('focus-view-active')
    const bodyHadFocusClass = document.body.classList.contains('focus-view-active')
    const appliance = document.querySelector<HTMLElement>('.appliance')
    const applianceWasInert = appliance?.hasAttribute('inert') ?? false
    const previousAriaHidden = appliance?.getAttribute('aria-hidden')
    document.body.style.overflow = 'hidden'
    document.documentElement.classList.add('focus-view-active')
    document.body.classList.add('focus-view-active')
    appliance?.setAttribute('inert', '')
    appliance?.setAttribute('aria-hidden', 'true')
    requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onFullscreenChange = () => {
      if (document.fullscreenElement) fullscreenWasActiveRef.current = true
      else if (fullscreenWasActiveRef.current) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && canExit) { event.preventDefault(); exit() } }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      if (!htmlHadFocusClass) document.documentElement.classList.remove('focus-view-active')
      if (!bodyHadFocusClass) document.body.classList.remove('focus-view-active')
      if (appliance) {
        if (!applianceWasInert) appliance.removeAttribute('inert')
        if (previousAriaHidden == null) appliance.removeAttribute('aria-hidden')
        else appliance.setAttribute('aria-hidden', previousAriaHidden)
      }
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [canExit, exit, onClose])

  return createPortal(
    <div aria-labelledby="prepare-focus-title" aria-modal="true" className="active-brew-summary active-brew-summary--preparing" data-display-mode={fullscreenActive ? 'fullscreen' : 'focus'} data-theme={dark ? 'dark' : 'light'} role="dialog">
      <div aria-hidden="true" className="active-brew-summary__graph"><BrewGraph decorative emptyMessage="Live graph begins with Bloom." milestones={milestones} source={traceBuffer} theme={dark ? 'dark' : 'light'} timeDomainSeconds={recipe.brewTime} variant="backdrop" weightDomainTargetGrams={recipe.water} /></div>
      <div className="active-brew-summary__content active-brew-summary__content--preparing">
        <header className="active-brew-summary__header">
          <div className="active-brew-summary__stage"><span>Guided brew</span><strong id="prepare-focus-title">{stage === 'ready' ? 'Ready to brew' : 'Prepare to brew'}</strong><small>{recipe.name}</small></div>
          <button aria-label={fullscreenActive ? 'Exit full-screen brew preparation' : 'Exit brew focus view'} className="active-brew-summary__utility" disabled={!canExit} onClick={exit} ref={closeButtonRef} type="button"><Minimize2 aria-hidden="true" /></button>
        </header>
        <div className="focus-prep">
        {stage === 'confirm' ? <>
          <div className="prep-recipe"><Coffee aria-hidden="true" /><div><strong>{recipe.name}</strong><span>{formatRecipeWeight(recipe.coffee)} g coffee · {formatRecipeWeight(expectedRecipeYield(recipe))} g expected yield · {formatTime(recipe.brewTime)}</span>{coffeeBag ? <small>{coffeeBag.name} by {coffeeBag.roastery} · {formatRecipeWeight(coffeeBag.remainingWeightG)} g remaining</small> : <small>No coffee bag selected · inventory will not change</small>}</div></div>
          {lowStock ? <label className="prep-check prep-check--warning"><input checked={lowStockConfirmed} onChange={(event) => setLowStockConfirmed(event.target.checked)} type="checkbox" /><span>Only {formatRecipeWeight(coffeeBag!.remainingWeightG)} g is tracked for this {formatRecipeWeight(recipe.coffee)} g dose. Continue and mark the bag depleted when this brew completes.</span></label> : null}
          <label className="prep-check"><input checked={coffeeReady} onChange={(event) => setCoffeeReady(event.target.checked)} type="checkbox" /><span>Dry coffee and dripper are positioned on the upper scale.</span></label>
          <label className="prep-check"><input checked={carafeReady} onChange={(event) => setCarafeReady(event.target.checked)} type="checkbox" /><span>The empty carafe is positioned on the lower scale.</span></label>
          <div className="prep-health" aria-label="Scale availability"><span className={usableUpper ? 'ok' : 'warn'}>Upper {usableUpper ? 'ready' : 'unavailable'}</span><span className={usableLower ? 'ok' : 'warn'}>Lower {usableLower ? 'ready' : 'unavailable'}</span></div>
          <Button disabled={!coffeeReady || !carafeReady || (lowStock && !lowStockConfirmed)} fullWidth onClick={onPrepare} surface="device">Tare and prepare</Button>
        </> : null}
        {stage === 'working' ? <div className="prep-working"><span className="spinner" /><strong>Preparing PourFrame</strong><p>{message}</p></div> : null}
        {stage === 'ready' ? <div className="prep-decision"><strong>Everything is ready</strong><p>{message}</p><p>The timer starts immediately when you press Start brew.</p><Button fullWidth onClick={onStart} surface="device"><Play aria-hidden="true" />Start brew</Button></div> : null}
        {stage === 'timer' ? <div className="prep-decision" role="alert"><strong>Use timer-only mode?</strong><p>{message}</p><p>No live weights or sensor confidence will be recorded.</p><Button fullWidth onClick={onStartTimer} surface="device">Start timer only</Button><Button fullWidth onClick={exit} surface="device" variant="secondary">Cancel</Button></div> : null}
        </div>
      </div>
    </div>, document.body,
  )
}

function LiveReadings({ telemetry, target, stepTarget, flowTarget, mode, relative, phase, cue, dualTare }: { telemetry: DeviceTelemetry | null; target: number; stepTarget: number; flowTarget: number; mode: BrewMode; relative: { relativeUpper: number | null; relativeLower: number | null; stepWaterAdded: number | null }; phase: BrewMachineState['phase']; cue: string; dualTare: DualTareControl }) {
  const upper = mode === 'device' ? telemetry?.scales.upper.grams ?? null : null
  const lower = mode === 'device' && usableScale(telemetry?.scales.lower) ? telemetry!.scales.lower.grams : null
  const total = mode === 'device' && telemetry?.total.available && !telemetry.total.partial && Number.isFinite(telemetry.total.grams) ? telemetry.total.grams : null
  const stepWaterAdded = mode === 'device' ? relative.stepWaterAdded : null
  const measuredRate = mode === 'device' && telemetry?.total.available ? telemetry.total.pour_rate_g_s : null
  const remaining = stepWaterAdded == null ? null : stepTarget - stepWaterAdded
  const warning = mode === 'timer_only' ? 'Timer-only · scale data unavailable' : phase === 'WAITING_FOR_STABLE_BASELINE' ? 'Waiting for synchronized scale data.' : telemetry?.total.partial ? 'Partial measurement · reduced confidence' : !liveScaleTelemetry(telemetry) ? 'Scale connection unavailable' : !completePairedTelemetry(telemetry) ? 'Waiting for synchronized scale data.' : null
  return <section className={warning ? 'brew-readings brew-readings--warning' : 'brew-readings'} aria-label="Live brew readings">
    <div className="brew-readings__tools"><strong>Brew readings</strong><Button disabled={!dualTare.enabled || dualTare.busy} onClick={() => void dualTare.tareBoth()} type="button" variant="secondary">{dualTare.busy ? 'Taring…' : 'Tare both scales'}</Button></div>
    {dualTare.message ? <p className="dual-tare-message" role="status">{dualTare.message}</p> : null}
    <div className="brew-readings__primary"><span>Current step water</span><strong>{stepWaterAdded == null ? '—' : `${formatWeight(stepWaterAdded)} g`}</strong><small>{remaining == null ? `Step target ${formatRecipeWeight(stepTarget)} g` : remaining > 0 ? `${formatWeight(remaining)} g remaining` : `${formatWeight(Math.abs(remaining))} g over target`}</small></div>
    <dl><div><dt>Cumulative water</dt><dd>{total == null ? '—' : `${formatWeight(total)} g`}</dd><small>Target {formatRecipeWeight(target)} g</small></div><div><dt>Dripper absolute</dt><dd>{upper == null ? '—' : `${formatWeight(upper)} g`}</dd><small>Relative {mode === 'device' && relative.relativeUpper != null ? `${formatWeight(relative.relativeUpper)} g` : '—'}</small></div><div><dt>Final beverage weight</dt><dd>{lower == null ? '—' : `${formatWeight(lower)} g`}</dd><small>Measured on lower scale</small></div><div><dt>Pour rate</dt><dd>{measuredRate == null ? '—' : `${formatWeight(measuredRate)} g/s`}</dd><small>Guidance {formatRecipeWeight(flowTarget)} g/s{measuredRate == null ? '' : ` · ${measuredRate >= flowTarget ? '+' : ''}${formatWeight(measuredRate - flowTarget)} g/s`}</small></div></dl>
    {warning ? <div className="brew-reading-state"><strong role="status">{warning}</strong></div> : null}
  </section>
}

interface BrewWorkspaceProps {
  recipe: BrewRecipe
  coffeeBags: CoffeeBagRecord[]
  coffeeBagId: string | null
  onCoffeeBagChange: (id: string | null) => void
  status: BrewStatus
  elapsed: number
  mode: BrewMode
  telemetry: DeviceTelemetry | null
  machine: BrewMachineState
  relative: { relativeUpper: number | null; relativeLower: number | null; stepWaterAdded: number | null }
  cue: string
  message: string
  traceBuffer: NonNullable<ReturnType<typeof useGuidedBrew>['traceBuffer']>
  dualTare: DualTareControl
  canStartDevice: boolean
  canResumeDevice: boolean
  deviceBlocked: boolean
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onFinish: () => Promise<void>
  onManualAdvance: () => void
  onTimerOnly: () => void
  onOpenFocus: () => void
}

function BrewWorkspace({ recipe, coffeeBags, coffeeBagId, onCoffeeBagChange, status, elapsed, mode, telemetry, machine, relative, cue, message, traceBuffer, dualTare, canStartDevice, canResumeDevice, deviceBlocked, onStart, onPause, onReset, onFinish, onManualAdvance, onTimerOnly, onOpenFocus }: BrewWorkspaceProps) {
  const schedule = useMemo(() => buildSchedule(recipe), [recipe])
  const index = machine.phase === 'DRAWDOWN' || machine.phase === 'COMPLETE' ? schedule.length - 1 : Math.max(0, machine.currentStepIndex)
  const step = schedule[index] ?? schedule[0]
  const readingStep = step.kind === 'drawdown' ? schedule[Math.max(0, index - 1)] : step
  const next = schedule[index + 1]
  const progress = Math.min(1, elapsed / recipe.brewTime)
  const active = status === 'brewing' || status === 'paused'
  const selectedBag = coffeeBags.find((bag) => bag.id === coffeeBagId) ?? null
  return <div className="brew-layout">
    <section className="brew-hero" aria-labelledby="brew-title">
      <div className="brew-hero__copy"><p className="brew-eyebrow">Guided brew</p><h2 className="page-title page-title--default" id="brew-title">{recipe.name}</h2><label className="brew-coffee-select"><span>Coffee bag</span><select disabled={active} value={coffeeBagId ?? ''} onChange={(event) => onCoffeeBagChange(event.target.value || null)}><option value="">No coffee bag</option>{coffeeBags.map((bag) => <option key={bag.id} value={bag.id}>{bag.name} · {bag.roastery} · {formatRecipeWeight(bag.remainingWeightG)} g{bag.remainingWeightG <= 0 ? ' · depleted' : ''}</option>)}</select></label>{selectedBag ? <small className={selectedBag.remainingWeightG < recipe.coffee ? 'brew-coffee-stock brew-coffee-stock--warning' : 'brew-coffee-stock'}>{selectedBag.remainingWeightG < recipe.coffee ? 'Low tracked stock · confirmation required' : `${formatRecipeWeight(selectedBag.remainingWeightG)} g remaining`}</small> : null}</div>
      <div className="brew-timer"><span>{status === 'paused' ? 'Paused' : active ? step.name : status === 'complete' ? 'Complete' : 'Ready'}</span><strong>{formatTime(elapsed)}</strong><small>{formatTime(recipe.brewTime)} total</small></div>
      <dl className="brew-key-metrics"><div><dt>Coffee dose</dt><dd>{formatRecipeWeight(recipe.coffee)} g</dd></div><div><dt>Expected yield</dt><dd>{formatRecipeWeight(expectedRecipeYield(recipe))} g</dd><small>Coffee × ratio</small></div><div><dt>Brew time</dt><dd>{formatTime(recipe.brewTime)}</dd></div></dl>
      <div className="brew-actions">
        {!active ? <Button disabled={!canStartDevice} onClick={onStart}><Play aria-hidden="true" />{status === 'complete' ? 'Brew again' : 'Prepare brew'}</Button> : <Button disabled={deviceBlocked && !canResumeDevice} onClick={onPause}>{status === 'paused' ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{deviceBlocked && !canResumeDevice ? 'Waiting for device' : status === 'paused' ? 'Resume' : 'Pause'}</Button>}
        <Button disabled={elapsed === 0 && status === 'idle'} onClick={onReset} variant="secondary"><RotateCcw aria-hidden="true" />Reset</Button>
        {active ? <Button onClick={onOpenFocus} variant="secondary"><Maximize2 aria-hidden="true" />Full screen</Button> : null}
        {active ? <Button disabled={deviceBlocked} onClick={onManualAdvance} variant="secondary">Advance step</Button> : null}
        {(machine.phase === 'WAITING_FOR_STABLE_BASELINE' || deviceBlocked) && mode === 'device' ? <Button onClick={onTimerOnly} variant="secondary">Continue timer only</Button> : null}
        {active ? <Button onClick={onFinish} variant="secondary">Finish</Button> : null}
      </div>
      <div className="brew-progress" role="progressbar" aria-label="Brew progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div>
    </section>
    <LiveReadings telemetry={telemetry} target={step.cumulative} stepTarget={readingStep.pour} flowTarget={recipe.flowRate} mode={mode} relative={relative} phase={machine.phase} cue={cue} dualTare={dualTare} />
    {message ? <p className="brew-session-message" role="status">{message}</p> : null}
    <section className="brew-graph-card" aria-labelledby="live-brew-graph-heading"><SectionHeader className="brew-graph-card__header" eyebrow="Automatic recording" title="Live brew graph" titleId="live-brew-graph-heading" trailing={<span>{mode === 'timer_only' ? 'Timer only' : status === 'brewing' ? 'Recording' : status === 'paused' ? 'Paused' : status === 'complete' ? 'Saved' : 'Ready'}</span>} /><BrewGraph source={traceBuffer} milestones={brewMilestones(recipe, schedule, machine.transitions)} /></section>
    <section className="brew-guide" aria-live="polite"><div className="brew-guide__current"><span>Current step · target {formatRecipeWeight(step.cumulative)} g</span><h3 className="guided-step-title">{step.name}</h3><p>{step.instruction}</p>{next ? <div className="next-step"><span>Next</span><strong>{next.name} at {formatTime(next.start)}</strong><ChevronRight aria-hidden="true" /></div> : null}</div><ol className="brew-timeline">{schedule.map((item, itemIndex) => <li className={itemIndex < index ? 'done' : itemIndex === index ? 'active' : ''} key={item.id}><span>{itemIndex < index ? '✓' : itemIndex + 1}</span><div><strong>{item.name}</strong><small>{formatRecipeWeight(item.cumulative)} g · {formatTime(item.start)}</small></div></li>)}</ol></section>
  </div>
}

type RecipeFilter = 'all' | 'hot' | 'iced'
type RecipeSort = 'name' | 'dose' | 'time'

function sortRecipes(recipes: BrewRecipe[], sort: RecipeSort) {
  return [...recipes].sort((left, right) => {
    if (sort === 'dose') return left.coffee - right.coffee || left.name.localeCompare(right.name)
    if (sort === 'time') return left.brewTime - right.brewTime || left.name.localeCompare(right.name)
    return left.name.localeCompare(right.name)
  })
}

function RecipeWorkspace({ recipes, brews, onSelect, onSave, onDelete }: { recipes: BrewRecipe[]; brews: BrewRecord[]; onSelect: (recipe: BrewRecipe) => void; onSave: (recipe: BrewRecipe) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<BrewRecipe | null>(null)
  const [filter, setFilter] = useState<RecipeFilter>('all')
  const [sort, setSort] = useState<RecipeSort>('name')
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement | null>(null)
  const visible = useMemo(() => recipes.map(migrateRecipe).filter((recipe) => filter === 'all' || recipe.serveStyle === filter), [filter, recipes])
  const selected = visible.find((recipe) => recipe.id === selectedId) ?? recipes.find((recipe) => recipe.id === selectedId) ?? null
  const starred = useMemo(() => sortRecipes(visible.filter((recipe) => recipe.starred), sort), [sort, visible])
  const starredIds = useMemo(() => new Set(starred.map((recipe) => recipe.id)), [starred])
  const recent = useMemo(() => {
    const seen = new Set(starredIds)
    const found: BrewRecipe[] = []
    for (const brew of [...brews].sort((left, right) => Date.parse(right.completed_at) - Date.parse(left.completed_at))) {
      const recipe = visible.find((item) => item.id === brew.recipe.id)
      if (recipe && !seen.has(recipe.id)) { seen.add(recipe.id); found.push(recipe) }
      if (found.length === 3) break
    }
    return found
  }, [brews, starredIds, visible])
  const recentIds = useMemo(() => new Set(recent.map((recipe) => recipe.id)), [recent])
  const all = useMemo(() => sortRecipes(visible.filter((recipe) => !starredIds.has(recipe.id) && !recentIds.has(recipe.id)), sort), [recentIds, sort, starredIds, visible])
  const toggleStar = async (recipe: BrewRecipe) => { try { await onSave({ ...recipe, starred: !recipe.starred }) } catch (error) { setMessage(error instanceof Error ? error.message : 'Recipe could not be updated.') } }
  const save = async () => {
    if (!draft) return
    const normalized = normalizeRecipe(draft)
    const validation = validateRecipe(normalized)
    if (!validation.valid) { setMessage(Object.values(validation.errors)[0] ?? 'Recipe is invalid.'); return }
    try { await onSave(normalized); onSelect(normalized); setDraft(null); setSelectedId(normalized.id); setMessage('Recipe saved on PourFrame.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Recipe could not be saved.') }
  }
  const remove = async (recipe: BrewRecipe) => { if (!window.confirm(`Delete ${recipe.name}?`)) return; try { await onDelete(recipe.id); setSelectedId(null) } catch (error) { setMessage(error instanceof Error ? error.message : 'Recipe could not be deleted.') } }
  const exportRecipe = (recipe: BrewRecipe) => {
    const file = new Blob([JSON.stringify({ v: 1, recipe: migrateRecipe(recipe) }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = `${recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pourframe-recipe'}.json`; link.click(); URL.revokeObjectURL(url)
  }
  const importRecipe = async (file: File | undefined) => {
    if (!file) return
    try {
      const payload = JSON.parse(await file.text()) as { v?: unknown; recipe?: unknown }
      if (payload.v !== 1 || !payload.recipe || typeof payload.recipe !== 'object') throw new Error('Choose a PourFrame recipe file.')
      const imported = migrateRecipe({ ...(payload.recipe as BrewRecipe), id: createId('recipe'), starred: false })
      if (!validateRecipe(imported).valid) throw new Error('This recipe file has unsupported values.')
      setDraft(imported); setMessage('Review the imported recipe before saving it.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Recipe could not be imported.') }
    finally { if (fileInput.current) fileInput.current.value = '' }
  }
  const numberField = (label: string, field: keyof BrewRecipe, step: number, suffix: string) => draft ? <label className="recipe-field"><span>{label}</span><div><input min="0" onChange={(event) => setDraft((current) => current ? updateRecipeNumber(current, field, Number(event.target.value)) : current)} step={step} type="number" value={formatRecipeInput(Number(draft[field]))} /><small>{suffix}</small></div></label> : null
  const recipeCard = (recipe: BrewRecipe) => <LibraryItemCard className="recipe-card" key={recipe.id} label={recipe.name} onOpen={() => setSelectedId(recipe.id)} onToggleStar={() => void toggleStar(recipe)} openClassName="recipe-card__open" starred={recipe.starred}><strong className="card-title">{recipe.name}</strong><span>{recipe.serveStyle === 'iced' ? 'Iced brew' : 'Hot brew'} · {recipe.dripper}</span><small>{formatRecipeWeight(recipe.coffee)} g coffee · {formatRecipeWeight(expectedRecipeYield(recipe))} g yield · {formatTime(recipe.brewTime)}</small></LibraryItemCard>
  const group = (title: string, values: BrewRecipe[]) => values.length ? <section className="library-group"><SectionHeader count={values.length} title={title} variant="compact" /><div className="recipe-collection">{values.map(recipeCard)}</div></section> : null
  return <section className="library-workspace recipe-library-workspace">
    <PageHeader actions={<div className="library-header-actions"><input accept="application/json,.json" aria-label="Import recipe" hidden onChange={(event) => void importRecipe(event.target.files?.[0])} ref={fileInput} type="file" /><Button onClick={() => fileInput.current?.click()} type="button" variant="secondary"><FileUp aria-hidden="true" />Import</Button><Button className="new-recipe" onClick={() => setDraft({ ...defaultRecipes[0], id: createId('recipe'), name: 'New recipe', starred: false, serveStyle: 'hot' })} variant="secondary">New recipe</Button></div>} className="library-workspace__header" description="Choose a trusted recipe, then send it to the brew dock." eyebrow="Shared library" title="Recipes" variant="library" />
    <div className="library-controls"><label><span>Serve</span><select onChange={(event) => setFilter(event.target.value as RecipeFilter)} value={filter}><option value="all">All recipes</option><option value="hot">Hot brew</option><option value="iced">Iced brew</option></select></label><label><span>Sort</span><select onChange={(event) => setSort(event.target.value as RecipeSort)} value={sort}><option value="name">Name A–Z</option><option value="dose">Coffee dose</option><option value="time">Brew time</option></select></label></div>
    {group('Starred', starred)}{group('Last brewed', recent)}{group('All recipes', all)}
    {!visible.length ? <EmptyState description="Change the filter or add a new recipe." icon={<BookOpen aria-hidden="true" />} title="No matching recipes" /> : null}<p className="library-message" role="status">{message}</p>
    {selected ? <Modal onClose={() => setSelectedId(null)} title={selected.name}><div className="library-modal__body"><div className="modal-toolbar"><button className={selected.starred ? 'library-star active' : 'library-star'} onClick={() => void toggleStar(selected)} type="button"><Star aria-hidden="true" />{selected.starred ? 'Starred' : 'Star'}</button><button onClick={() => setDraft(migrateRecipe(selected))} type="button"><Pencil aria-hidden="true" />Edit</button><button onClick={() => exportRecipe(selected)} type="button"><Download aria-hidden="true" />Export</button><button className="danger" onClick={() => void remove(selected)} type="button"><Trash2 aria-hidden="true" />Delete</button></div><dl className="library-detail"><div><dt>Serving</dt><dd>{selected.serveStyle === 'iced' ? 'Iced brew' : 'Hot brew'}</dd></div><div><dt>Brewer</dt><dd>{selected.dripper}</dd></div><div><dt>Coffee dose</dt><dd>{formatRecipeWeight(selected.coffee)} g</dd></div><div><dt>Expected yield</dt><dd>{formatRecipeWeight(expectedRecipeYield(selected))} g</dd></div><div><dt>Brew time</dt><dd>{formatTime(selected.brewTime)}</dd></div><div><dt>Temperature</dt><dd>{formatRecipeWeight(selected.temperature)} °C</dd></div><div><dt>Notes</dt><dd>{selected.notes || 'No notes'}</dd></div></dl><Button fullWidth onClick={() => { onSelect(selected); setSelectedId(null) }} type="button">Use for next brew</Button></div></Modal> : null}
    {draft ? <Modal onClose={() => setDraft(null)} title={recipes.some((recipe) => recipe.id === draft.id) ? 'Edit recipe' : 'Recipe details'}><div className="library-modal__body recipe-edit-form"><label className="recipe-field recipe-field--wide"><span>Recipe name</span><input maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name} /></label><div className="recipe-metrics"><label><span>Coffee dose</span><div><input min="0.1" onChange={(event) => setDraft(updateRecipeNumber(draft, 'coffee', Number(event.target.value)))} step="0.5" type="number" value={formatRecipeInput(draft.coffee)} /><small>g</small></div></label><div className="recipe-metric-readonly"><span>Expected yield</span><strong>{formatRecipeWeight(expectedRecipeYield(draft))} g</strong><small>Coffee dose × ratio</small></div><label><span>Brew time</span><div><input min="90" onChange={(event) => setDraft(updateRecipeNumber(draft, 'brewTime', Number(event.target.value)))} step="5" type="number" value={formatRecipeInput(draft.brewTime)} /><small>{formatTime(draft.brewTime)}</small></div></label></div><label className="recipe-field"><span>Serving style</span><select onChange={(event) => setDraft({ ...draft, serveStyle: event.target.value as BrewRecipe['serveStyle'] })} value={draft.serveStyle}><option value="hot">Hot brew</option><option value="iced">Iced brew</option></select></label><div className="recipe-grid">{numberField('Total water', 'water', 1, 'g')}{numberField('Ratio', 'ratio', 0.1, ':1')}{numberField('Bloom', 'bloom', 1, 'g')}{numberField('Pours after bloom', 'poursAfterBloom', 1, '')}{numberField('Flow rate', 'flowRate', 0.1, 'g/s')}{numberField('Temperature', 'temperature', 1, '°C')}</div><label className="recipe-field recipe-field--wide"><span>Notes</span><textarea maxLength={500} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} value={draft.notes} /></label><Button fullWidth onClick={() => void save()} type="button"><Save aria-hidden="true" />Save recipe</Button></div></Modal> : null}
  </section>
}

function HistoryBrewItem({ brew }: { brew: BrewRecord }) {
  const [expanded, setExpanded] = useState(() => Boolean(brew.trace?.available))
  const [samples, setSamples] = useState<BrewTraceSample[] | null>(null)
  const [traceState, setTraceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [traceMessage, setTraceMessage] = useState('')
  const load = useCallback(async () => {
    if (!brew.trace?.available) return
    setTraceState('loading'); setTraceMessage('Loading saved trace…')
    try {
      const loaded = await loadBrewTrace(brew.id)
      setSamples(loaded); setTraceState('ready'); setTraceMessage('')
    } catch (error) {
      setTraceState('error'); setTraceMessage(error instanceof Error ? error.message : 'The saved trace could not be loaded.')
    }
  }, [brew.id, brew.trace?.available])
  useEffect(() => {
    if (expanded && traceState === 'idle' && brew.trace?.available) void load()
  }, [brew.trace?.available, expanded, load, traceState])
  const toggle = () => setExpanded((value) => !value)
  const milestones = useMemo(() => brewMilestones(brew.recipe, brew.schedule, brew.transitions), [brew.recipe, brew.schedule, brew.transitions])
  return <article className={expanded ? 'history-brew history-brew--expanded' : 'history-brew'}>
    <button aria-expanded={expanded} className="history-brew__summary" onClick={toggle} type="button">
      <div><strong>{brew.recipe.name}</strong><span>{new Date(brew.completed_at).toLocaleString()}</span>{brew.coffee_bag ? <small>{brew.coffee_bag.name} · {brew.coffee_bag.roastery}{brew.coffee_used_g == null ? '' : ` · ${formatRecipeWeight(brew.coffee_used_g)} g used`}</small> : null}</div>
      <dl><div><dt>Time</dt><dd>{formatTime(brew.elapsed_s)}</dd></div><div><dt>Final beverage weight</dt><dd>{brew.final.beverage_g == null ? '—' : `${formatWeight(brew.final.beverage_g)} g`}</dd><small>Measured on lower scale</small></div><div><dt>Expected yield</dt><dd>{formatRecipeWeight(expectedRecipeYield(brew.recipe))} g</dd><small>Coffee × ratio</small></div><div><dt>Trace</dt><dd>{brew.trace?.available ? `${brew.trace.sample_count} samples` : '—'}</dd></div></dl>
      <ChevronRight aria-hidden="true" />
    </button>
    {expanded ? <div className="history-brew__graph">
      {!brew.trace?.available ? <p>This timer-only or legacy brew has no recorded scale graph.</p> : null}
      {traceState === 'loading' ? <p>Loading saved trace…</p> : null}
      {traceState === 'error' ? <div className="history-trace-error"><p role="alert">{traceMessage}</p><Button onClick={() => void load()} variant="secondary">Retry</Button></div> : null}
      {traceState === 'ready' && samples ? <BrewGraph compact samples={samples} milestones={milestones} emptyMessage="This brew trace contains no plottable scale values." /> : null}
    </div> : null}
  </article>
}

function HistoryWorkspace({ brews, onClear }: { brews: BrewRecord[]; onClear: () => Promise<void> }) {
  return <section className="history-workspace"><PageHeader actions={<Button disabled={!brews.length} onClick={() => window.confirm('Clear all shared brew history?') && void onClear()} variant="secondary">Clear history</Button>} className="history-workspace__header" eyebrow="Shared on PourFrame · latest five" title="Brew history" variant="compact" />{brews.length ? <div className="history-list">{brews.map((brew) => <HistoryBrewItem brew={brew} key={brew.id} />)}</div> : <EmptyState description="Choose a recipe and coffee bag below, then prepare your first guided brew. Its result will be saved here." icon={<History aria-hidden="true" />} title="Take PourFrame for its first brew" variant="full" />}</section>
}

function BrewDock({ recipe, coffeeBag, disabled, onAction, action }: { recipe: BrewRecipe; coffeeBag: CoffeeBagRecord | null; disabled: boolean; onAction: () => void; action: 'prepare' | 'fullscreen' | 'resume' }) {
  const active = action !== 'prepare'
  const label = action === 'prepare' ? 'Prepare brew' : action === 'resume' ? 'Resume brew' : 'Full screen'
  return <aside aria-label={active ? 'Active brew controls' : 'Next brew'} className="brew-dock"><div className="brew-dock__selection"><span>{active ? action === 'resume' ? 'Brew paused' : 'Brew in progress' : 'Next brew'}</span><strong>{recipe.name}</strong><small>{coffeeBag ? `${coffeeBag.name} · ${coffeeBag.roastery}` : 'No coffee bag selected'}</small></div><Button disabled={disabled} onClick={onAction} type="button">{action === 'fullscreen' ? <Maximize2 aria-hidden="true" /> : <Play aria-hidden="true" />}{label}</Button></aside>
}

function DeviceStatusBanner({ availability, browserNetwork, reconnectAttempt, onReconnect }: {
  availability: DeviceAvailability
  browserNetwork: BrowserNetworkState
  reconnectAttempt: number
  onReconnect: () => void
}) {
  if (availability === 'online' && browserNetwork === 'online') return null
  const title = availability === 'offline'
    ? 'PourFrame device offline'
    : availability === 'connecting'
      ? reconnectAttempt > 0 ? 'Reconnecting to PourFrame' : 'Connecting to PourFrame'
      : availability === 'stale'
        ? 'PourFrame telemetry unavailable'
        : availability === 'partial'
          ? 'One PourFrame scale is unavailable'
          : 'Browser offline'
  const description = availability === 'offline'
    ? 'Live weighing and device-controlled brewing require PourFrame. Cached recipes, coffee bags, and completed brews remain available.'
    : availability === 'connecting'
      ? `${reconnectAttempt ? `Reconnect attempt ${reconnectAttempt}. ` : ''}Live controls will return only after valid telemetry is received.`
      : availability === 'stale'
        ? 'The device connection is present, but current synchronized measurements are not available. Live readings and commands are paused.'
        : availability === 'partial'
          ? 'The connected device is reporting only one usable scale. Scale-controlled brewing requires both synchronized scales.'
          : 'Internet access appears unavailable. Local PourFrame device status is still determined by live telemetry.'
  const reconnectable = availability === 'offline' || availability === 'stale'

  return <div className={`device-status-banner device-status-banner--${availability}`} role="status">
    <div><strong>{title}</strong><span>{description}</span>{browserNetwork === 'offline' && availability !== 'online' ? <small>Browser network status: offline</small> : null}</div>
    {reconnectable ? <button className="device-status-banner__action" onClick={onReconnect} type="button"><RefreshCw aria-hidden="true" />Reconnect</button> : null}
  </div>
}

function App() {
  const [navigation, setNavigation] = useState(() => parseAppHash(window.location.hash))
  const { tab } = navigation
  const [recipe, setRecipe] = useState<BrewRecipe>(defaultRecipes[0])
  const device = useDevice(recipe)
  const library = useLibrary()
  const pwaInstall = usePwaInstall()
  const [coffeeBagId, setCoffeeBagId] = useState<string | null>(() => {
    const stored = storedValue('pourframe.coffeeBag.selected.v1')
    return stored === '__none__' ? null : stored
  })
  const coffeeBagSelectionInitialized = useRef(storedValue('pourframe.coffeeBag.selected.v1') !== null)
  const [sound, setSound] = useState(() => storedValue('pourframe.sound') !== 'off')
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference)
  const systemDark = useSystemDarkMode()
  const dark = themePreference === 'system' ? systemDark : themePreference === 'dark'
  const [brewFocusOpen, setBrewFocusOpen] = useState(false)
  const [brewFocusFullscreenActive, setBrewFocusFullscreenActive] = useState(false)
  const [brewSelectionOpen, setBrewSelectionOpen] = useState(false)
  useFullscreenWakeLock(brewFocusFullscreenActive)
  const focusOriginHash = useRef('')
  const coffeeBag = library.coffeeBags.find((bag) => bag.id === coffeeBagId) ?? null
  const guided = useGuidedBrew(recipe, coffeeBag, device.liveTelemetry, device.connection, device.sendCommand, device.sendProtocolCommand, library.saveBrew)
  const toggleSound = useCallback(() => {
    const enabled = !sound
    setAudioEnabled(enabled)
    setSound(enabled)
  }, [sound])

  useEffect(() => {
    const selected = library.recipes.find((item) => item.id === storedValue('pourframe.lastRecipe')) ?? library.recipes[0]
    if (selected && !library.recipes.some((item) => item.id === recipe.id)) setRecipe(migrateRecipe(selected))
  }, [library.recipes, recipe.id])

  useEffect(() => {
    if (!coffeeBagSelectionInitialized.current && library.coffeeBags.length) {
      coffeeBagSelectionInitialized.current = true
      setCoffeeBagId(library.coffeeBags.find((bag) => bag.remainingWeightG > 0)?.id ?? null)
      return
    }
    if (coffeeBagId && !library.coffeeBags.some((bag) => bag.id === coffeeBagId)) setCoffeeBagId(null)
  }, [coffeeBagId, library.coffeeBags])

  useEffect(() => {
    setAudioEnabled(sound)
    storeValue('pourframe.sound', sound ? 'on' : 'off')
  }, [sound])
  useEffect(() => { storeValue(themePreferenceKey, themePreference) }, [themePreference])
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    document.documentElement.dataset.splashTheme = dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#050f09' : '#fafdfa')
  }, [dark])
  useEffect(() => { storeValue('pourframe.lastRecipe', recipe.id) }, [recipe.id])
  useEffect(() => {
    const syncNavigationFromHash = () => {
      setNavigation(parseAppHash(window.location.hash))
    }
    window.addEventListener('hashchange', syncNavigationFromHash)
    return () => window.removeEventListener('hashchange', syncNavigationFromHash)
  }, [])
  useEffect(() => {
    if (coffeeBagId) storeValue('pourframe.coffeeBag.selected.v1', coffeeBagId)
    else if (coffeeBagSelectionInitialized.current) storeValue('pourframe.coffeeBag.selected.v1', '__none__')
  }, [coffeeBagId])

  const selectRecipe = (next: BrewRecipe) => { setRecipe(migrateRecipe(next)); guided.reset() }
  const online = device.availability === 'online'
  const commandsEnabled = device.availability === 'online' || device.availability === 'partial'
  const canStartDevice = online && completePairedTelemetry(device.liveTelemetry)
  const tareBothAvailable = commandsEnabled && usableScale(device.liveTelemetry?.scales.upper) && usableScale(device.liveTelemetry?.scales.lower) &&
    (guided.status === 'idle' || guided.status === 'complete') && guided.prepStage == null
  const dualTare = useDualTare(device.sendCommand, tareBothAvailable)
  const focusMilestones = useMemo(() => scheduledBrewMilestones(guided.schedule), [guided.schedule])
  const openBrewFocus = useCallback(() => {
    setBrewFocusOpen(true)
    if (document.fullscreenElement) {
      setBrewFocusFullscreenActive(document.fullscreenElement === document.documentElement)
      return
    }
    setBrewFocusFullscreenActive(false)
    if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) return
    void document.documentElement.requestFullscreen()
      .then(() => setBrewFocusFullscreenActive(document.fullscreenElement === document.documentElement))
      .catch(() => setBrewFocusFullscreenActive(false))
  }, [])
  const closeBrewFocus = useCallback((restoreOrigin = false) => {
    setBrewFocusOpen(false)
    setBrewFocusFullscreenActive(false)
    if (restoreOrigin && focusOriginHash.current && window.location.hash !== focusOriginHash.current) window.location.hash = focusOriginHash.current
  }, [])
  const startPreparationFocus = useCallback(() => {
    focusOriginHash.current = window.location.hash
    guided.setPrepStage('confirm')
    openBrewFocus()
  }, [guided, openBrewFocus])
  const openBrewSelection = useCallback(() => {
    if (!canStartDevice || guided.prepStage != null || guided.status === 'brewing' || guided.status === 'paused') return
    setBrewSelectionOpen(true)
  }, [canStartDevice, guided.prepStage, guided.status])
  const confirmBrewSelection = useCallback((recipeId: string, nextCoffeeBagId: string | null) => {
    const nextRecipe = library.recipes.find((item) => item.id === recipeId) ?? recipe
    const recipeChanged = nextRecipe.id !== recipe.id
    if (recipeChanged || guided.status === 'complete') guided.reset()
    if (recipeChanged) setRecipe(migrateRecipe(nextRecipe))
    coffeeBagSelectionInitialized.current = true
    setCoffeeBagId(nextCoffeeBagId)
    setBrewSelectionOpen(false)
    startPreparationFocus()
  }, [guided, library.recipes, recipe, startPreparationFocus])
  const closePreparationFocus = useCallback(() => {
    guided.setPrepStage(null)
    closeBrewFocus(true)
  }, [closeBrewFocus, guided])
  const resumeInFocus = useCallback(() => {
    openBrewFocus()
    guided.pauseResume()
  }, [guided, openBrewFocus])
  const activeBrew = guided.status === 'brewing' || guided.status === 'paused'
  const preparationDockVisible = (tab === 'history' || tab === 'beans' || tab === 'recipes') && guided.prepStage == null && !activeBrew && !brewFocusOpen && !brewSelectionOpen
  const reentryDockVisible = activeBrew && !brewFocusOpen
  const headerTitle = tab === 'brew' ? recipe.name : tab === 'beans' ? 'Beans' : tab === 'recipes' ? 'Recipes' : tab === 'device' ? 'Settings' : 'Brew history'
  const headerTitleVariant = tab === 'history' || tab === 'beans' || tab === 'recipes' ? 'library' : 'compact'

  return <main className="appliance" data-theme={dark ? 'dark' : 'light'}>
    <header className="appliance-header"><h1 className={`page-title page-title--${headerTitleVariant} appliance-header__title`}><a href={tab === 'brew' ? '#history' : appHash(tab)}>{headerTitle}</a></h1><nav aria-label="Primary navigation">{([['history', 'History', History], ['beans', 'Beans', Coffee], ['recipes', 'Recipes', BookOpen]] as const).map(([id, label, Icon]) => <a aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} href={appHash(id)} key={id}><Icon aria-hidden="true" />{label}</a>)}</nav><div className="appliance-actions"><a aria-current={tab === 'device' ? 'page' : undefined} aria-label="Settings" className={tab === 'device' ? 'settings-tab active' : 'settings-tab'} href="#device"><Scale aria-hidden="true" /><span>Settings</span></a><span className={online ? 'appliance-connection online' : 'appliance-connection'}><i />{device.availability === 'partial' ? 'One scale live' : online ? 'Scale live' : device.availability === 'stale' ? 'Telemetry stale' : device.connection === 'connecting' ? 'Finding scale' : 'Scale offline'}</span>{pwaInstall.canInstall ? <button className="install-app" onClick={() => void pwaInstall.install()} type="button"><Download aria-hidden="true" /><span>Install app</span></button> : null}<button aria-label={sound ? 'Mute brew sounds' : 'Enable brew sounds'} onClick={toggleSound}>{sound ? <Volume2 /> : <VolumeX />}</button><button aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setThemePreference((current) => {
      const currentDark = current === 'system' ? systemDark : current === 'dark'
      return currentDark ? 'light' : 'dark'
    })}>{dark ? <Sun /> : <Moon />}</button></div></header>
    <DeviceStatusBanner availability={device.availability} browserNetwork={device.browserNetwork} reconnectAttempt={device.reconnectAttempt} onReconnect={device.reconnect} />
    {library.hasLegacy ? <div className="legacy-banner"><span>Browser-saved PourOver recipes were found.</span><button onClick={() => void library.importLegacy()}>Import to PourFrame</button></div> : null}
    {library.status !== 'ready' ? <div className={`library-status library-status--${library.status}`} role="status">{library.message}</div> : null}
    <div className="appliance-body">
      {tab === 'brew' ? <BrewWorkspace recipe={recipe} coffeeBags={library.coffeeBags} coffeeBagId={coffeeBagId} onCoffeeBagChange={(id) => { coffeeBagSelectionInitialized.current = true; setCoffeeBagId(id) }} status={guided.status} elapsed={guided.elapsed} mode={guided.machine.mode} telemetry={device.liveTelemetry} machine={guided.machine} relative={guided.relative} cue={guided.physicalCue} message={guided.message} traceBuffer={guided.traceBuffer!} dualTare={dualTare} canStartDevice={canStartDevice} canResumeDevice={canStartDevice} deviceBlocked={guided.deviceBlocked} onStart={openBrewSelection} onPause={guided.pauseResume} onReset={guided.reset} onFinish={guided.finish} onManualAdvance={guided.manualAdvance} onTimerOnly={guided.continueTimerOnly} onOpenFocus={openBrewFocus} /> : null}
      {tab === 'beans' ? <CoffeeBagWorkspace bags={library.coffeeBags} onDelete={library.deleteCoffeeBag} onSave={library.saveCoffeeBag} onUse={(id) => { coffeeBagSelectionInitialized.current = true; setCoffeeBagId(id) }} /> : null}
      {tab === 'recipes' ? <RecipeWorkspace brews={library.brews} onDelete={async (id) => { await library.deleteRecipe(id); if (recipe.id === id) selectRecipe(library.recipes.find((item) => item.id !== id) ?? defaultRecipes[0]) }} onSave={library.saveRecipe} onSelect={selectRecipe} recipes={library.recipes} /> : null}
      {tab === 'history' ? <HistoryWorkspace brews={library.brews} onClear={library.clearBrews} /> : null}
      {tab === 'device' ? <DeviceWorkspace telemetry={device.liveTelemetry} connection={device.connection} availability={device.availability} lastUpdateAt={device.lastUpdateAt} sendCommand={device.sendCommand} saveWifi={device.saveWifi} mockMode={device.mockMode} dualTare={dualTare} /> : null}
    </div>
    {preparationDockVisible ? <BrewDock action="prepare" coffeeBag={coffeeBag} disabled={!canStartDevice} onAction={openBrewSelection} recipe={recipe} /> : null}
    {reentryDockVisible ? <BrewDock action={guided.status === 'paused' ? 'resume' : 'fullscreen'} coffeeBag={coffeeBag} disabled={guided.status === 'paused' && guided.deviceBlocked && !canStartDevice} onAction={guided.status === 'paused' ? resumeInFocus : openBrewFocus} recipe={recipe} /> : null}
    {brewSelectionOpen ? <BrewSelectionSheet coffeeBags={library.coffeeBags} dark={dark} onClose={() => setBrewSelectionOpen(false)} onConfirm={confirmBrewSelection} recipes={library.recipes} selectedCoffeeBagId={coffeeBagId} selectedRecipeId={recipe.id} /> : null}
    {brewFocusOpen && guided.prepStage ? <PreparationFocus dark={dark} fullscreenActive={brewFocusFullscreenActive} stage={guided.prepStage} message={guided.message} recipe={recipe} coffeeBag={coffeeBag} usableUpper={usableScale(device.liveTelemetry?.scales.upper)} usableLower={usableScale(device.liveTelemetry?.scales.lower)} onClose={closePreparationFocus} onPrepare={() => void guided.prepare()} onStart={guided.startPrepared} onStartTimer={guided.startTimerOnly} traceBuffer={guided.traceBuffer!} milestones={focusMilestones} /> : null}
    {brewFocusOpen && !guided.prepStage && (activeBrew || guided.status === 'complete') ? <ActiveBrewSummary dark={dark} elapsed={guided.elapsed} fullscreenActive={brewFocusFullscreenActive} machine={guided.machine} message={guided.message} milestones={focusMilestones} mode={guided.machine.mode} onEnd={guided.finish} onExit={() => closeBrewFocus(false)} onPauseResume={guided.pauseResume} onToggleSound={toggleSound} recipe={recipe} schedule={guided.schedule} sound={sound} status={guided.status} telemetry={device.liveTelemetry} traceBuffer={guided.traceBuffer!} /> : null}
  </main>
}

export default App
