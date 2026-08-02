import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { BookOpen, ChevronRight, Coffee, Download, History, Maximize2, Moon, Pause, Play, RefreshCw, RotateCcw, Save, Scale, Sun, Volume2, VolumeX } from 'lucide-react'
import { ActiveBrewSummary } from './ActiveBrewSummary'
import { setAudioEnabled } from './audio'
import { CheckIcon, ClockIcon, CloseIcon, SettingsIcon } from './icons'
import { buildSchedule, createId, expectedRecipeYield, formatRecipeInput, formatRecipeWeight, formatTime, migrateRecipe, normalizeRecipe, updateRecipeNumber, validateRecipe } from './brew'
import { BrewGraph, brewMilestones } from './BrewGraph'
import { completePairedTelemetry, liveScaleTelemetry, type BrewMachineState } from './brewMachine'
import { tareBothScales } from './brewSession'
import type { BrewMode, BrewRecipe, BrewRecord, BrewStatus, CoffeeBag as CoffeeBagRecord } from './brewTypes'
import { CoffeeBagWorkspace } from './CoffeeBagWorkspace'
import { defaultRecipes } from './defaultRecipes'
import { loadBrewTrace, useLibrary } from './library'
import { appHash, parseAppHash, type RecipeLibraryView } from './navigation'
import { usePwaInstall } from './pwa'
import type { BrewTraceSample } from './trace'
import type { DeviceTelemetry, MeasurementTelemetry, ScaleId, ScaleTelemetry, TargetId, TotalTelemetry } from './types'
import { usableScale, useDevice, type BrowserNetworkState, type ConnectionState, type DeviceAvailability } from './useDevice'
import { useGuidedBrew } from './useGuidedBrew'
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
        <h2 id={`${id}-heading`}>{label}</h2>
        <div className={unavailable ? 'weight weight--unavailable' : 'weight'} aria-live="polite">
          <span>{weight}</span>
          {!unavailable ? <small>g</small> : null}
        </div>
        <MeasurementLine measurement={measurement} fault={unavailable || Boolean(scale?.stale || scale?.saturated)} />
        <p className="raw-reading">
          <span>Raw</span> {raw}
        </p>
        <div className="scale-actions">
          <button className="button button--primary" disabled={!commandsEnabled || unavailable || scale?.calibrating} onClick={tare}>
            Tare
          </button>
          <button className="button button--secondary" disabled={!commandsEnabled || unavailable || scale?.calibrating} onClick={() => onCalibrate(id)}>
            {scale?.calibrating ? 'Calibrating…' : 'Calibrate'}
          </button>
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
            <h2 id="total-weight-heading">Total Weight</h2>
          </div>
          <span className={total?.partial ? 'total-source total-source--partial' : 'total-source'}>{sourceLabel}</span>
        </div>
        <div className="total-tare">
          <button className="button button--primary" disabled={!dualTare.enabled || dualTare.busy} onClick={() => void dualTare.tareBoth()} type="button">
            {dualTare.busy ? 'Taring both…' : 'Tare both scales'}
          </button>
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

interface ModalProps {
  title: string
  children: ReactNode
  onClose: () => void
}

function Modal({ title, children, onClose }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        {children}
      </section>
    </div>
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
        <button className="button button--primary button--full" disabled={submitting} type="submit">
          {submitting ? 'Starting…' : 'Start calibration'}
        </button>
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
        <button className="button button--primary button--full" type="submit">Save Wi-Fi</button>
      </form>
    </Modal>
  )
}

function HealthItem({ label, value, healthy, clock = false }: { label: string; value: string; healthy: boolean; clock?: boolean }) {
  const Icon = clock ? ClockIcon : CheckIcon
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
      <div className="device-workspace__heading">
        <div><p className="brew-eyebrow">Device</p><h2>Scale and connectivity</h2></div>
        <div className="header-status">
          <span className="hostname">pourframe.local</span>
          <span className={online ? 'connection connection--online' : 'connection connection--offline'}><i /> {availability === 'partial' ? 'One scale unavailable' : online ? 'Device online' : connection === 'connecting' ? 'Connecting' : availability === 'stale' ? 'Telemetry degraded' : 'Device offline'}</span>
          <button className="settings-button" disabled={!commandsEnabled} onClick={() => setSettingsOpen(true)}><SettingsIcon /> Wi-Fi</button>
        </div>
      </div>
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

function PreparationModal({ stage, message, recipe, coffeeBag, usableUpper, usableLower, onClose, onPrepare, onStart, onStartTimer }: PreparationModalProps) {
  const [coffeeReady, setCoffeeReady] = useState(false)
  const [carafeReady, setCarafeReady] = useState(false)
  const [lowStockConfirmed, setLowStockConfirmed] = useState(false)
  const lowStock = Boolean(coffeeBag && coffeeBag.remainingWeightG < recipe.coffee)
  return (
    <Modal title={stage === 'ready' ? 'Ready to brew' : 'Prepare to brew'} onClose={stage === 'working' ? () => undefined : onClose}>
      <div className="prep-flow">
        {stage === 'confirm' ? <>
          <div className="prep-recipe"><Coffee aria-hidden="true" /><div><strong>{recipe.name}</strong><span>{formatRecipeWeight(recipe.coffee)} g coffee · {formatRecipeWeight(expectedRecipeYield(recipe))} g expected yield · {formatTime(recipe.brewTime)}</span>{coffeeBag ? <small>{coffeeBag.name} by {coffeeBag.roastery} · {formatRecipeWeight(coffeeBag.remainingWeightG)} g remaining</small> : <small>No coffee bag selected · inventory will not change</small>}</div></div>
          {lowStock ? <label className="prep-check prep-check--warning"><input checked={lowStockConfirmed} onChange={(event) => setLowStockConfirmed(event.target.checked)} type="checkbox" /><span>Only {formatRecipeWeight(coffeeBag!.remainingWeightG)} g is tracked for this {formatRecipeWeight(recipe.coffee)} g dose. Continue and mark the bag depleted when this brew completes.</span></label> : null}
          <label className="prep-check"><input checked={coffeeReady} onChange={(event) => setCoffeeReady(event.target.checked)} type="checkbox" /><span>Dry coffee and dripper are positioned on the upper scale.</span></label>
          <label className="prep-check"><input checked={carafeReady} onChange={(event) => setCarafeReady(event.target.checked)} type="checkbox" /><span>The empty carafe is positioned on the lower scale.</span></label>
          <div className="prep-health" aria-label="Scale availability"><span className={usableUpper ? 'ok' : 'warn'}>Upper {usableUpper ? 'ready' : 'unavailable'}</span><span className={usableLower ? 'ok' : 'warn'}>Lower {usableLower ? 'ready' : 'unavailable'}</span></div>
          <button className="button button--primary button--full" disabled={!coffeeReady || !carafeReady || (lowStock && !lowStockConfirmed)} onClick={onPrepare}>Tare and prepare</button>
        </> : null}
        {stage === 'working' ? <div className="prep-working"><span className="spinner" /><strong>Preparing PourFrame</strong><p>{message}</p></div> : null}
        {stage === 'ready' ? <div className="prep-decision"><strong>Everything is ready</strong><p>{message}</p><p>The timer starts immediately when you press Start brew.</p><button className="button button--primary button--full" onClick={onStart}><Play aria-hidden="true" />Start brew</button></div> : null}
        {stage === 'timer' ? <div className="prep-decision" role="alert"><strong>Use timer-only mode?</strong><p>{message}</p><p>No live weights or sensor confidence will be recorded.</p><button className="button button--primary button--full" onClick={onStartTimer}>Start timer only</button><button className="button button--secondary button--full" onClick={onClose}>Cancel</button></div> : null}
      </div>
    </Modal>
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
    <div className="brew-readings__tools"><strong>Brew readings</strong><button className="brew-secondary" disabled={!dualTare.enabled || dualTare.busy} onClick={() => void dualTare.tareBoth()} type="button">{dualTare.busy ? 'Taring…' : 'Tare both scales'}</button></div>
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
  sound: boolean
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
  onToggleSound: () => void
}

function BrewWorkspace({ recipe, coffeeBags, coffeeBagId, onCoffeeBagChange, status, elapsed, mode, telemetry, machine, relative, cue, message, sound, traceBuffer, dualTare, canStartDevice, canResumeDevice, deviceBlocked, onStart, onPause, onReset, onFinish, onManualAdvance, onTimerOnly, onToggleSound }: BrewWorkspaceProps) {
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryFullscreenActive, setSummaryFullscreenActive] = useState(false)
  const summaryTriggerRef = useRef<HTMLButtonElement | null>(null)
  const schedule = useMemo(() => buildSchedule(recipe), [recipe])
  const index = machine.phase === 'DRAWDOWN' || machine.phase === 'COMPLETE' ? schedule.length - 1 : Math.max(0, machine.currentStepIndex)
  const step = schedule[index] ?? schedule[0]
  const readingStep = step.kind === 'drawdown' ? schedule[Math.max(0, index - 1)] : step
  const next = schedule[index + 1]
  const progress = Math.min(1, elapsed / recipe.brewTime)
  const active = status === 'brewing' || status === 'paused'
  const selectedBag = coffeeBags.find((bag) => bag.id === coffeeBagId) ?? null
  const openSummary = useCallback(() => {
    setSummaryOpen(true)
    if (document.fullscreenElement) {
      setSummaryFullscreenActive(true)
      return
    }
    setSummaryFullscreenActive(false)
    if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) return
    void document.documentElement.requestFullscreen()
      .then(() => setSummaryFullscreenActive(document.fullscreenElement === document.documentElement))
      .catch(() => setSummaryFullscreenActive(false))
  }, [])
  const closeSummary = useCallback(() => {
    setSummaryOpen(false)
    setSummaryFullscreenActive(false)
    requestAnimationFrame(() => summaryTriggerRef.current?.focus())
  }, [])
  return <div className="brew-layout">
    <section className="brew-hero" aria-labelledby="brew-title">
      <div className="brew-hero__copy"><p className="brew-eyebrow">Guided brew</p><h2 id="brew-title">{recipe.name}</h2><label className="brew-coffee-select"><span>Coffee bag</span><select disabled={active} value={coffeeBagId ?? ''} onChange={(event) => onCoffeeBagChange(event.target.value || null)}><option value="">No coffee bag</option>{coffeeBags.map((bag) => <option key={bag.id} value={bag.id}>{bag.name} · {bag.roastery} · {formatRecipeWeight(bag.remainingWeightG)} g{bag.remainingWeightG <= 0 ? ' · depleted' : ''}</option>)}</select></label>{selectedBag ? <small className={selectedBag.remainingWeightG < recipe.coffee ? 'brew-coffee-stock brew-coffee-stock--warning' : 'brew-coffee-stock'}>{selectedBag.remainingWeightG < recipe.coffee ? 'Low tracked stock · confirmation required' : `${formatRecipeWeight(selectedBag.remainingWeightG)} g remaining`}</small> : null}</div>
      <div className="brew-timer"><span>{status === 'paused' ? 'Paused' : active ? step.name : status === 'complete' ? 'Complete' : 'Ready'}</span><strong>{formatTime(elapsed)}</strong><small>{formatTime(recipe.brewTime)} total</small></div>
      <dl className="brew-key-metrics"><div><dt>Coffee dose</dt><dd>{formatRecipeWeight(recipe.coffee)} g</dd></div><div><dt>Expected yield</dt><dd>{formatRecipeWeight(expectedRecipeYield(recipe))} g</dd><small>Coffee × ratio</small></div><div><dt>Brew time</dt><dd>{formatTime(recipe.brewTime)}</dd></div></dl>
      <div className="brew-actions">
        {!active ? <button className="brew-primary" disabled={!canStartDevice} onClick={onStart}><Play aria-hidden="true" />{status === 'complete' ? 'Brew again' : 'Prepare brew'}</button> : <button className="brew-primary" disabled={deviceBlocked && !canResumeDevice} onClick={onPause}>{status === 'paused' ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{deviceBlocked && !canResumeDevice ? 'Waiting for device' : status === 'paused' ? 'Resume' : 'Pause'}</button>}
        <button className="brew-secondary" disabled={elapsed === 0 && status === 'idle'} onClick={onReset}><RotateCcw aria-hidden="true" />Reset</button>
        {active ? <button className="brew-secondary" onClick={openSummary} ref={summaryTriggerRef}><Maximize2 aria-hidden="true" />Full screen</button> : null}
        {active ? <button className="brew-secondary" disabled={deviceBlocked} onClick={onManualAdvance}>Advance step</button> : null}
        {(machine.phase === 'WAITING_FOR_STABLE_BASELINE' || deviceBlocked) && mode === 'device' ? <button className="brew-secondary" onClick={onTimerOnly}>Continue timer only</button> : null}
        {active ? <button className="brew-secondary" onClick={onFinish}>Finish</button> : null}
      </div>
      <div className="brew-progress" role="progressbar" aria-label="Brew progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ width: `${progress * 100}%` }} /></div>
    </section>
    <LiveReadings telemetry={telemetry} target={step.cumulative} stepTarget={readingStep.pour} flowTarget={recipe.flowRate} mode={mode} relative={relative} phase={machine.phase} cue={cue} dualTare={dualTare} />
    {message ? <p className="brew-session-message" role="status">{message}</p> : null}
    <section className="brew-graph-card" aria-labelledby="live-brew-graph-heading"><div className="section-heading"><div><p className="brew-eyebrow">Automatic recording</p><h3 id="live-brew-graph-heading">Live brew graph</h3></div><span>{mode === 'timer_only' ? 'Timer only' : status === 'brewing' ? 'Recording' : status === 'paused' ? 'Paused' : status === 'complete' ? 'Saved' : 'Ready'}</span></div><BrewGraph source={traceBuffer} milestones={brewMilestones(recipe, schedule, machine.transitions)} /></section>
    <section className="brew-guide" aria-live="polite"><div className="brew-guide__current"><span>Current step · target {formatRecipeWeight(step.cumulative)} g</span><h3>{step.name}</h3><p>{step.instruction}</p>{next ? <div className="next-step"><span>Next</span><strong>{next.name} at {formatTime(next.start)}</strong><ChevronRight aria-hidden="true" /></div> : null}</div><ol className="brew-timeline">{schedule.map((item, itemIndex) => <li className={itemIndex < index ? 'done' : itemIndex === index ? 'active' : ''} key={item.id}><span>{itemIndex < index ? '✓' : itemIndex + 1}</span><div><strong>{item.name}</strong><small>{formatRecipeWeight(item.cumulative)} g · {formatTime(item.start)}</small></div></li>)}</ol></section>
    {summaryOpen ? <ActiveBrewSummary
      elapsed={elapsed}
      fullscreenActive={summaryFullscreenActive}
      machine={machine}
      message={message}
      mode={mode}
      onEnd={onFinish}
      onExit={closeSummary}
      onPauseResume={onPause}
      onToggleSound={onToggleSound}
      recipe={recipe}
      schedule={schedule}
      sound={sound}
      status={status}
      telemetry={telemetry}
    /> : null}
  </div>
}

function RecipeWorkspace({ recipes, active, onSelect, onSave, onDelete }: { recipes: BrewRecipe[]; active: BrewRecipe; onSelect: (recipe: BrewRecipe) => void; onSave: (recipe: BrewRecipe) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [draft, setDraft] = useState(active)
  const [message, setMessage] = useState('')
  useEffect(() => setDraft(migrateRecipe(active)), [active])
  const numberField = (label: string, field: keyof BrewRecipe, step: number, suffix: string) => <label className="recipe-field"><span>{label}</span><div><input type="number" step={step} value={formatRecipeInput(Number(draft[field]))} onChange={(event) => setDraft((value) => updateRecipeNumber(value, field, Number(event.target.value)))} /><small>{suffix}</small></div></label>
  const save = () => { const validation = validateRecipe(draft); if (!validation.valid) { setMessage(Object.values(validation.errors)[0] ?? 'Recipe is invalid'); return } setMessage('Saving to PourFrame…'); void onSave(normalizeRecipe(draft)).then(() => setMessage('Saved on PourFrame')).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Save failed')) }
  return <div className="recipe-workspace"><aside className="recipe-library"><div><p className="brew-eyebrow">Shared library</p><h2>Brew recipes</h2></div><button className="new-recipe" onClick={() => setDraft({ ...defaultRecipes[0], id: createId('recipe'), name: 'New recipe' })}>New recipe</button><ul>{recipes.map((recipe) => <li key={recipe.id}><button className={recipe.id === active.id ? 'active' : ''} onClick={() => onSelect(migrateRecipe(recipe))}><strong>{recipe.name}</strong><span>{formatRecipeWeight(recipe.coffee)} g coffee · {formatRecipeWeight(expectedRecipeYield(recipe))} g expected yield</span><small>{formatTime(recipe.brewTime)} brew</small></button><button aria-label={`Delete ${recipe.name}`} className="recipe-delete" onClick={() => void onDelete(recipe.id)}>×</button></li>)}</ul></aside><section className="recipe-editor"><div className="editor-heading"><div><p className="brew-eyebrow">Expert controls</p><h2>Edit recipe</h2></div><button className="brew-primary" onClick={save}><Save aria-hidden="true" />Save</button></div><label className="recipe-field recipe-field--wide"><span>Recipe name</span><input maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <div className="recipe-metrics">
      <label><span>Coffee dose</span><div><input min="0.1" max="80" step="0.5" type="number" value={formatRecipeInput(draft.coffee)} onChange={(event) => setDraft((value) => updateRecipeNumber(value, 'coffee', Number(event.target.value)))} /><small>g</small></div></label>
      <div className="recipe-metric-readonly"><span>Expected yield</span><strong>{formatRecipeWeight(expectedRecipeYield(draft))} g</strong><small>Coffee dose × ratio</small></div>
      <label><span>Brew time</span><div><input min="90" max="420" step="5" type="number" value={formatRecipeInput(draft.brewTime)} onChange={(event) => setDraft((value) => updateRecipeNumber(value, 'brewTime', Number(event.target.value)))} /><small>{formatTime(draft.brewTime)}</small></div></label>
    </div>
    <div className="recipe-grid">{numberField('Total water', 'water', 1, 'g')}{numberField('Ratio', 'ratio', 0.1, ':1')}{numberField('Bloom', 'bloom', 1, 'g')}{numberField('Pours after bloom', 'poursAfterBloom', 1, '')}{numberField('Flow rate', 'flowRate', 0.1, 'g/s')}{numberField('Temperature', 'temperature', 1, '°C')}</div><label className="recipe-field recipe-field--wide"><span>Notes</span><textarea maxLength={500} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label><p className="library-message" role="status">{message}</p></section></div>
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
      {traceState === 'error' ? <div className="history-trace-error"><p role="alert">{traceMessage}</p><button className="brew-secondary" onClick={() => void load()}>Retry</button></div> : null}
      {traceState === 'ready' && samples ? <BrewGraph compact samples={samples} milestones={milestones} emptyMessage="This brew trace contains no plottable scale values." /> : null}
    </div> : null}
  </article>
}

function HistoryWorkspace({ brews, onClear }: { brews: BrewRecord[]; onClear: () => Promise<void> }) {
  return <section className="history-workspace"><div className="section-heading"><div><p className="brew-eyebrow">Shared on PourFrame · latest five</p><h2>Brew history</h2></div><button className="brew-secondary" disabled={!brews.length} onClick={() => window.confirm('Clear all shared brew history?') && void onClear()}>Clear history</button></div>{brews.length ? <div className="history-list">{brews.map((brew) => <HistoryBrewItem brew={brew} key={brew.id} />)}</div> : <div className="empty-history"><History aria-hidden="true" /><h3>No completed brews yet</h3><p>Your next completed brew will be saved here for everyone using this PourFrame.</p></div>}</section>
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
  const device = useDevice()
  const library = useLibrary()
  const pwaInstall = usePwaInstall()
  const [navigation, setNavigation] = useState(() => {
    const savedRecipeView: RecipeLibraryView = storedValue('pourframe.recipes.view.v1') === 'recipes' ? 'recipes' : 'coffee'
    return parseAppHash(window.location.hash, savedRecipeView)
  })
  const { tab, recipeLibraryView } = navigation
  const [recipe, setRecipe] = useState<BrewRecipe>(defaultRecipes[0])
  const [coffeeBagId, setCoffeeBagId] = useState<string | null>(() => {
    const stored = storedValue('pourframe.coffeeBag.selected.v1')
    return stored === '__none__' ? null : stored
  })
  const coffeeBagSelectionInitialized = useRef(storedValue('pourframe.coffeeBag.selected.v1') !== null)
  const [sound, setSound] = useState(() => storedValue('pourframe.sound') !== 'off')
  const [dark, setDark] = useState(() => storedValue('pourframe.theme') === 'dark')
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
  useEffect(() => { storeValue('pourframe.theme', dark ? 'dark' : 'light') }, [dark])
  useEffect(() => { storeValue('pourframe.lastRecipe', recipe.id) }, [recipe.id])
  useEffect(() => { storeValue('pourframe.recipes.view.v1', recipeLibraryView) }, [recipeLibraryView])
  useEffect(() => {
    const syncNavigationFromHash = () => {
      const savedRecipeView: RecipeLibraryView = storedValue('pourframe.recipes.view.v1') === 'recipes' ? 'recipes' : 'coffee'
      setNavigation(parseAppHash(window.location.hash, savedRecipeView))
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

  return <main className="appliance" data-theme={dark ? 'dark' : 'light'}>
    <header className="appliance-header"><a className="brand" href="#brew"><span>PF</span><div><strong>PourFrame</strong><small>Local brewing appliance</small></div></a><nav aria-label="Primary navigation">{([['brew', 'Brew', Coffee], ['recipes', 'Recipes', BookOpen], ['history', 'History', History], ['device', 'Device', Scale]] as const).map(([id, label, Icon]) => <a aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} href={appHash(id, recipeLibraryView)} key={id}><Icon aria-hidden="true" />{label}</a>)}</nav><div className="appliance-actions"><span className={online ? 'appliance-connection online' : 'appliance-connection'}><i />{device.availability === 'partial' ? 'One scale live' : online ? 'Scale live' : device.availability === 'stale' ? 'Telemetry stale' : device.connection === 'connecting' ? 'Finding scale' : 'Scale offline'}</span>{pwaInstall.canInstall ? <button className="install-app" onClick={() => void pwaInstall.install()} type="button"><Download aria-hidden="true" /><span>Install app</span></button> : null}<button aria-label={sound ? 'Mute brew sounds' : 'Enable brew sounds'} onClick={toggleSound}>{sound ? <Volume2 /> : <VolumeX />}</button><button aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark((value) => !value)}>{dark ? <Sun /> : <Moon />}</button></div></header>
    <DeviceStatusBanner availability={device.availability} browserNetwork={device.browserNetwork} reconnectAttempt={device.reconnectAttempt} onReconnect={device.reconnect} />
    {library.hasLegacy ? <div className="legacy-banner"><span>Browser-saved PourOver recipes were found.</span><button onClick={() => void library.importLegacy()}>Import to PourFrame</button></div> : null}
    {library.status !== 'ready' ? <div className={`library-status library-status--${library.status}`} role="status">{library.message}</div> : null}
    <div className="appliance-body">
      {tab === 'brew' ? <BrewWorkspace recipe={recipe} coffeeBags={library.coffeeBags} coffeeBagId={coffeeBagId} onCoffeeBagChange={(id) => { coffeeBagSelectionInitialized.current = true; setCoffeeBagId(id) }} status={guided.status} elapsed={guided.elapsed} mode={guided.machine.mode} telemetry={device.liveTelemetry} machine={guided.machine} relative={guided.relative} cue={guided.physicalCue} message={guided.message} sound={sound} traceBuffer={guided.traceBuffer!} dualTare={dualTare} canStartDevice={canStartDevice} canResumeDevice={canStartDevice} deviceBlocked={guided.deviceBlocked} onStart={() => guided.setPrepStage('confirm')} onPause={guided.pauseResume} onReset={guided.reset} onFinish={guided.finish} onManualAdvance={guided.manualAdvance} onTimerOnly={guided.continueTimerOnly} onToggleSound={toggleSound} /> : null}
      {tab === 'recipes' ? <div className="recipes-area"><div className="recipe-section-tabs" role="tablist" aria-label="Recipe library sections"><a aria-selected={recipeLibraryView === 'coffee'} className={recipeLibraryView === 'coffee' ? 'active' : ''} href={appHash('recipes', 'coffee')} role="tab">Coffee bags</a><a aria-selected={recipeLibraryView === 'recipes'} className={recipeLibraryView === 'recipes' ? 'active' : ''} href={appHash('recipes', 'recipes')} role="tab">Brew recipes</a></div>{recipeLibraryView === 'coffee' ? <CoffeeBagWorkspace bags={library.coffeeBags} onSave={library.saveCoffeeBag} onDelete={library.deleteCoffeeBag} /> : <RecipeWorkspace recipes={library.recipes} active={recipe} onSelect={selectRecipe} onSave={async (value) => { await library.saveRecipe(value); selectRecipe(value) }} onDelete={async (id) => { await library.deleteRecipe(id); if (recipe.id === id) selectRecipe(library.recipes.find((item) => item.id !== id) ?? defaultRecipes[0]) }} />}</div> : null}
      {tab === 'history' ? <HistoryWorkspace brews={library.brews} onClear={library.clearBrews} /> : null}
      {tab === 'device' ? <DeviceWorkspace telemetry={device.liveTelemetry} connection={device.connection} availability={device.availability} lastUpdateAt={device.lastUpdateAt} sendCommand={device.sendCommand} saveWifi={device.saveWifi} mockMode={device.mockMode} dualTare={dualTare} /> : null}
    </div>
    {guided.prepStage ? <PreparationModal stage={guided.prepStage} message={guided.message} recipe={recipe} coffeeBag={coffeeBag} usableUpper={usableScale(device.liveTelemetry?.scales.upper)} usableLower={usableScale(device.liveTelemetry?.scales.lower)} onClose={() => guided.setPrepStage(null)} onPrepare={() => void guided.prepare()} onStart={guided.startPrepared} onStartTimer={guided.startTimerOnly} /> : null}
  </main>
}

export default App
