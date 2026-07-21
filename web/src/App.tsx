import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { CheckIcon, ClockIcon, CloseIcon, SettingsIcon } from './icons'
import type { MeasurementTelemetry, ScaleId, ScaleTelemetry, TargetId, TotalTelemetry } from './types'
import { useDevice } from './useDevice'
import { WeightCapture } from './WeightCapture'

interface ScalePanelProps {
  id: ScaleId
  label: string
  scale: ScaleTelemetry | null
  measurement: MeasurementTelemetry | null
  onTare: (id: ScaleId) => Promise<void>
  onCalibrate: (id: ScaleId) => void
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
  onSetTarget: (id: TargetId, grams: number) => Promise<void>
  onClearTarget: (id: TargetId) => Promise<void>
}

function TargetControl({ id, label, targetGrams, history, primary = false, onSetTarget, onClearTarget }: TargetControlProps) {
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
        <button className="target-button target-button--save" disabled={targetSaving} type="submit">
          {targetSaving ? 'Saving…' : 'Save'}
        </button>
        <button className="target-button" disabled={targetSaving || targetGrams == null} onClick={clearTarget} type="button">
          Clear
        </button>
      </div>
      {history?.length ? (
        <div className="target-history" aria-label={`Recent ${label.toLowerCase()} values`}>
          <span>Recent</span>
          {history.map((grams) => (
            <button
              className={targetGrams === grams ? 'target-chip target-chip--active' : 'target-chip'}
              disabled={targetSaving}
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

function ScalePanel({ id, label, scale, measurement, onTare, onCalibrate }: ScalePanelProps) {
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
          <button className="button button--primary" disabled={unavailable || scale?.calibrating} onClick={tare}>
            Tare
          </button>
          <button className="button button--secondary" disabled={unavailable || scale?.calibrating} onClick={() => onCalibrate(id)}>
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
}

function TotalWeightSection({ total, upper, lower, measurement, onSetTarget, onClearTarget }: TotalWeightSectionProps) {
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
            history={upper?.target_history_grams}
            id="upper"
            label="Upper target"
            onClearTarget={onClearTarget}
            onSetTarget={onSetTarget}
            targetGrams={upper?.target_grams}
          />
          <TargetControl
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

function App() {
  const { telemetry, connection, lastUpdateAt, sendCommand, saveWifi, mockMode } = useDevice()
  const [calibrationChannel, setCalibrationChannel] = useState<ScaleId | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const updateAge = lastUpdateAt ? Math.max(0, now - lastUpdateAt) : 0
  const online = connection === 'online' && updateAge < 1500
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
    <main className="app-shell">
      <header className="app-header">
        <h1>Pourframe</h1>
        <div className="header-status">
          <span className="hostname">pourframe.local</span>
          <span className={online ? 'connection connection--online' : 'connection connection--offline'}>
            <i /> {online ? 'Device online' : connection === 'connecting' ? 'Connecting' : 'Device offline'}
          </span>
          <button className="settings-button" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon /> Settings
          </button>
        </div>
      </header>

      <TotalWeightSection
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
          id="upper"
          label="Upper / Dripper"
          measurement={telemetry?.measurement ?? null}
          onCalibrate={setCalibrationChannel}
          onTare={tare}
          scale={upper}
        />
        <ScalePanel
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

      <section className="responsive-note" aria-label="Responsive layout">
        <div className="desktop-mark" aria-hidden="true"><span /><span /></div>
        <span className="responsive-arrow" aria-hidden="true">→</span>
        <div className="mobile-mark" aria-hidden="true"><span /><span /></div>
        <p>On mobile, the two scale panels stack vertically<br />for easy reading and control.</p>
        {mockMode ? <small>Live preview mode</small> : null}
      </section>

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
    </main>
  )
}

export default App
