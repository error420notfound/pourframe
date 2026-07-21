import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { captureFilename, captureToCsv, MAX_CAPTURE_SAMPLES, telemetryToCaptureSample, type CaptureSample } from './capture'
import type { DeviceTelemetry } from './types'

interface WeightCaptureProps {
  telemetry: DeviceTelemetry | null
  online: boolean
}

type CapturePhase = 'idle' | 'recording' | 'stopped'
type CaptureColumns = [number[], Array<number | null>, Array<number | null>, Array<number | null>]

interface CaptureProgress {
  elapsedSeconds: number
  sampleCount: number
}

const emptyProgress: CaptureProgress = { elapsedSeconds: 0, sampleCount: 0 }

function emptyColumns(): CaptureColumns {
  return [[], [], [], []]
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds - minutes * 60
  return `${minutes.toString().padStart(2, '0')}:${remaining.toFixed(1).padStart(4, '0')}`
}

function cssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function plotOptions(width: number, height: number): uPlot.Options {
  const totalColor = cssColor('--chart-total', '#512612')
  const upperColor = cssColor('--chart-upper', '#336b8e')
  const lowerColor = cssColor('--chart-lower', '#247a36')
  const axisColor = cssColor('--muted', '#67615e')
  const gridColor = cssColor('--border', '#dedbd8')
  const value = (_plot: uPlot, raw: number | null) => raw == null ? '—' : `${raw.toFixed(2)} g`

  return {
    width,
    height,
    scales: { x: { time: false } },
    cursor: { drag: { setScale: false, x: false, y: false }, focus: { prox: 30 } },
    legend: { show: true, live: true },
    series: [
      {
        label: 'Time',
        value: (_plot, raw) => raw == null ? '—' : `${raw.toFixed(3)} s`,
      },
      { label: 'Total', stroke: totalColor, width: 2.5, spanGaps: false, points: { show: false }, value },
      { label: 'Upper', stroke: upperColor, width: 1.7, dash: [9, 5], spanGaps: false, points: { show: false }, value },
      { label: 'Lower', stroke: lowerColor, width: 1.7, dash: [2, 5], spanGaps: false, points: { show: false }, value },
    ],
    axes: [
      {
        label: 'Elapsed time (s)',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
        font: '12px Inter, ui-sans-serif, system-ui, sans-serif',
        labelFont: '600 12px Inter, ui-sans-serif, system-ui, sans-serif',
        values: (_plot, ticks) => ticks.map((tick) => tick.toFixed(tick < 10 ? 1 : 0)),
      },
      {
        label: 'Weight (g)',
        stroke: axisColor,
        grid: { stroke: gridColor, width: 1 },
        ticks: { stroke: gridColor, width: 1 },
        font: '12px Inter, ui-sans-serif, system-ui, sans-serif',
        labelFont: '600 12px Inter, ui-sans-serif, system-ui, sans-serif',
        values: (_plot, ticks) => ticks.map((tick) => tick.toFixed(1)),
        size: 62,
      },
    ],
  }
}

export function WeightCapture({ telemetry, online }: WeightCaptureProps) {
  const plotHostRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeAnimationFrameRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const recordingRef = useRef(false)
  const samplesRef = useRef<CaptureSample[]>([])
  const columnsRef = useRef<CaptureColumns>(emptyColumns())
  const firstUptimeRef = useRef<number | null>(null)
  const lastUptimeRef = useRef<number | null>(null)
  const lastTelemetrySequenceRef = useRef<number | null>(null)
  const captureStartedAtRef = useRef<Date | null>(null)
  const [phase, setPhase] = useState<CapturePhase>('idle')
  const [progress, setProgress] = useState<CaptureProgress>(emptyProgress)
  const [message, setMessage] = useState('Press Start to capture live weight data.')

  const schedulePlotUpdate = useCallback(() => {
    if (animationFrameRef.current !== null) return
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null
      plotRef.current?.setData(columnsRef.current)
    })
  }, [])

  const finishCapture = useCallback((detail: string) => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setPhase('stopped')
    setMessage(detail)
    schedulePlotUpdate()
  }, [schedulePlotUpdate])

  const appendTelemetry = useCallback((nextTelemetry: DeviceTelemetry) => {
    if (!recordingRef.current) return
    const uptime = nextTelemetry.uptime_ms
    const telemetrySequence = nextTelemetry.seq
    if (!Number.isFinite(uptime) || !Number.isFinite(telemetrySequence)) return

    const lastUptime = lastUptimeRef.current
    const lastTelemetrySequence = lastTelemetrySequenceRef.current
    if (lastUptime !== null && lastTelemetrySequence !== null) {
      if (telemetrySequence === lastTelemetrySequence) return
      if (uptime < lastUptime || telemetrySequence < lastTelemetrySequence) {
        finishCapture('Device restarted. Capture stopped with the collected data preserved.')
        return
      }
    }
    if (samplesRef.current.length >= MAX_CAPTURE_SAMPLES) {
      finishCapture('Capture reached the 100,000-sample limit and stopped automatically.')
      return
    }

    const firstUptime = firstUptimeRef.current ?? uptime
    firstUptimeRef.current = firstUptime
    lastUptimeRef.current = uptime
    lastTelemetrySequenceRef.current = telemetrySequence
    const sample = telemetryToCaptureSample(nextTelemetry, firstUptime)
    samplesRef.current.push(sample)
    columnsRef.current[0].push(sample.elapsedSeconds)
    columnsRef.current[1].push(sample.totalFiltered)
    columnsRef.current[2].push(sample.upperFiltered)
    columnsRef.current[3].push(sample.lowerFiltered)
    setProgress({ elapsedSeconds: sample.elapsedSeconds, sampleCount: samplesRef.current.length })
    schedulePlotUpdate()
  }, [finishCapture, schedulePlotUpdate])

  useEffect(() => {
    const host = plotHostRef.current
    if (!host) return

    const initialWidth = Math.max(280, Math.floor(host.getBoundingClientRect().width))
    const initialHeight = window.matchMedia('(max-width: 640px)').matches ? 220 : 300
    plotRef.current = new uPlot(plotOptions(initialWidth, initialHeight), columnsRef.current, host)

    resizeObserverRef.current = new ResizeObserver(() => {
      if (resizeAnimationFrameRef.current !== null) return
      resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
        resizeAnimationFrameRef.current = null
        const width = Math.floor(host.getBoundingClientRect().width)
        if (width <= 0) return
        const height = window.matchMedia('(max-width: 640px)').matches ? 220 : 300
        const plot = plotRef.current
        if (plot && (plot.width !== width || plot.height !== height)) plot.setSize({ width, height })
      })
    })
    resizeObserverRef.current.observe(host)

    return () => {
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      if (resizeAnimationFrameRef.current !== null) window.cancelAnimationFrame(resizeAnimationFrameRef.current)
      resizeAnimationFrameRef.current = null
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
      plotRef.current?.destroy()
      plotRef.current = null
    }
  }, [])

  useEffect(() => {
    if (telemetry) appendTelemetry(telemetry)
  }, [appendTelemetry, telemetry])

  const startCapture = () => {
    if (!telemetry || !online) return
    samplesRef.current = []
    columnsRef.current = emptyColumns()
    firstUptimeRef.current = null
    lastUptimeRef.current = null
    lastTelemetrySequenceRef.current = null
    captureStartedAtRef.current = new Date()
    recordingRef.current = true
    setPhase('recording')
    setProgress(emptyProgress)
    setMessage('Recording the live telemetry stream.')
    schedulePlotUpdate()
    appendTelemetry(telemetry)
  }

  const stopCapture = () => {
    finishCapture('Capture stopped. The data is ready to export.')
  }

  const exportCapture = () => {
    const startedAt = captureStartedAtRef.current
    if (phase !== 'stopped' || samplesRef.current.length === 0 || !startedAt) return
    const url = URL.createObjectURL(new Blob([captureToCsv(samplesRef.current)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = captureFilename(startedAt)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setMessage(`Exported ${samplesRef.current.length.toLocaleString('en-US')} samples as CSV.`)
  }

  const status = useMemo(() => {
    if (phase === 'recording') return online ? 'Recording' : 'Waiting for device'
    if (phase === 'stopped') return 'Stopped'
    return 'Ready'
  }, [online, phase])
  const canStart = Boolean(telemetry && online && phase !== 'recording')
  const canExport = phase === 'stopped' && progress.sampleCount > 0

  return (
    <section className="weight-capture" aria-labelledby="weight-capture-heading">
      <div className="weight-capture__header">
        <div className="weight-capture__copy">
          <h2 id="weight-capture-heading">Weight Capture</h2>
          <p>Record the combined, upper, and lower filtered weights against elapsed time.</p>
        </div>
        <div className="capture-controls" aria-label="Weight capture controls">
          <button className="capture-button capture-button--primary" disabled={!canStart} onClick={startCapture} type="button">
            Start
          </button>
          <button className="capture-button" disabled={phase !== 'recording'} onClick={stopCapture} type="button">
            Stop
          </button>
          <button className="capture-button" disabled={!canExport} onClick={exportCapture} type="button">
            Export CSV
          </button>
        </div>
      </div>

      <dl className="capture-stats">
        <div>
          <dt>Status</dt>
          <dd className={`capture-status capture-status--${phase}${phase === 'recording' && !online ? ' capture-status--waiting' : ''}`}>
            <i aria-hidden="true" />{status}
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(progress.elapsedSeconds)}</dd>
        </div>
        <div>
          <dt>Samples</dt>
          <dd>{progress.sampleCount.toLocaleString('en-US')}</dd>
        </div>
      </dl>

      <div className="capture-chart-frame">
        <div
          aria-label="Elapsed time chart of total, upper, and lower weight in grams"
          className="capture-chart"
          ref={plotHostRef}
          role="img"
        />
        {progress.sampleCount === 0 ? <p className="capture-chart__empty">Start a capture to plot live weight data.</p> : null}
      </div>
      <p className="capture-message" role="status">{message}</p>
    </section>
  )
}
