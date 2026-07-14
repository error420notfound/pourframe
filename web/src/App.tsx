import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { CheckIcon, ClockIcon, CloseIcon, SettingsIcon } from './icons'
import type { ScaleId, ScaleTelemetry } from './types'
import { useDevice } from './useDevice'

interface ScalePanelProps {
  id: ScaleId
  label: string
  scale: ScaleTelemetry | null
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

function SignalLine({ active }: { active: boolean }) {
  return (
    <div className={active ? 'signal signal--active' : 'signal'} aria-hidden="true">
      <svg viewBox="0 0 500 20" preserveAspectRatio="none">
        <path d="M1 10h255l7-3 9 6 8-5 9 4 8-6 8 7 8-5 8 4 8-7 8 7 9-4 8 2 8-5 9 7 8-6 9 8 7-5 9 2 8-6 8 8 8-4 8 3 8-5 8 5h25" />
      </svg>
      <span />
    </div>
  )
}

function ScalePanel({ id, label, scale, onTare, onCalibrate }: ScalePanelProps) {
  const [actionMessage, setActionMessage] = useState('')
  const unavailable = !scale || scale.disconnected
  const ready = Boolean(scale?.ready && !scale.stale)
  const normalizedGrams = scale && Math.abs(scale.grams) < 0.05 ? 0 : scale?.grams
  const weight = unavailable ? '—' : normalizedGrams?.toFixed(1) ?? '—'
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
        <SignalLine active={ready} />
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
        <p>Tare the empty platform first, place a known weight, choose its unit, then start the ten-sample calibration.</p>
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

  const upper = telemetry?.scales.upper ?? null
  const lower = telemetry?.scales.lower ?? null
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

      <div className="scale-grid">
        <ScalePanel id="upper" label="Upper / Dripper" onCalibrate={setCalibrationChannel} onTare={tare} scale={upper} />
        <ScalePanel id="lower" label="Lower / Carafe" onCalibrate={setCalibrationChannel} onTare={tare} scale={lower} />
      </div>

      <section className="health-rail" aria-label="Device status">
        <HealthItem healthy={Boolean(upper?.ready)} label="Upper HX711" value={upper?.ready ? 'Ready' : 'Unavailable'} />
        <HealthItem healthy={Boolean(lower?.ready)} label="Lower HX711" value={lower?.ready ? 'Ready' : 'Unavailable'} />
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
