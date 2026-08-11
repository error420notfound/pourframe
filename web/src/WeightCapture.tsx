import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LineSeriesOption } from 'echarts/charts'
import { captureFilename, captureToCsv, MAX_CAPTURE_SAMPLES, telemetryToCaptureSample, type CaptureSample } from './capture'
import type { DeviceTelemetry } from './types'
import { cssColor, withAlpha } from './chartTheme'
import { useEChart, type PourFrameChartOption } from './echarts'

interface WeightCaptureProps {
  telemetry: DeviceTelemetry | null
  online: boolean
}

type CapturePhase = 'idle' | 'recording' | 'stopped'
export type CaptureColumns = [number[], Array<number | null>, Array<number | null>, Array<number | null>]

interface CaptureProgress {
  elapsedSeconds: number
  sampleCount: number
}

interface TooltipDatum {
  axisValue?: number | string
  marker?: string
  seriesName?: string
  value?: unknown
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

function seriesData(times: number[], values: Array<number | null>): Array<[number, number | null]> {
  return times.map((time, index) => [time, values[index]])
}

function numericPointValue(value: unknown) {
  if (Array.isArray(value)) {
    const candidate = value[1]
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function tooltipFormatter(params: unknown) {
  const rows = (Array.isArray(params) ? params : [params]).filter(Boolean) as TooltipDatum[]
  const seconds = Number(rows[0]?.axisValue)
  const heading = Number.isFinite(seconds) ? `${seconds.toFixed(3)} s` : 'Weight capture'
  const values = rows.map((row) => {
    const value = numericPointValue(row.value)
    return `<div class="pourframe-chart-tooltip__row">${row.marker ?? ''}<span>${row.seriesName ?? 'Weight'}</span><strong>${value == null ? '—' : `${value.toFixed(2)} g`}</strong></div>`
  }).join('')
  return `<div class="pourframe-chart-tooltip__time">${heading}</div>${values}`
}

function captureSeries(columns: CaptureColumns): LineSeriesOption[] {
  const colors = [
    cssColor('--chart-total', 'rgba(255, 105, 20, 1)'),
    cssColor('--chart-upper', 'rgba(99, 56, 255, 1)'),
    cssColor('--chart-lower', 'rgba(0, 188, 78, 1)'),
  ]
  const names = ['Total', 'Upper', 'Lower']
  return names.map((name, index) => ({
    id: `capture-${name.toLowerCase()}`,
    name,
    type: 'line',
    data: seriesData(columns[0], columns[index + 1]),
    animation: false,
    smooth: 0.2,
    connectNulls: false,
    showSymbol: false,
    sampling: 'lttb',
    lineStyle: { color: withAlpha(colors[index], index === 0 ? 0.92 : 0.88), width: index === 0 ? 2.3 : 1.8, cap: 'round', join: 'round' },
    itemStyle: { color: colors[index] },
    areaStyle: { color: withAlpha(colors[index], index === 0 ? 0.12 : 0.08), origin: 'start' },
    emphasis: { focus: 'series' },
  }))
}

export function buildWeightCaptureOption(columns: CaptureColumns): PourFrameChartOption {
  const axis = cssColor('--muted', 'rgba(79, 94, 84, 1)')
  const grid = cssColor('--border', 'rgba(207, 221, 210, 1)')
  const surface = cssColor('--app-surface', 'rgba(255, 255, 255, 1)')
  const text = cssColor('--app-text', 'rgba(23, 21, 20, 1)')
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 62, right: 18, top: 46, bottom: 68, containLabel: false },
    legend: {
      show: true,
      top: 2,
      left: 52,
      right: 74,
      selectedMode: true,
      itemWidth: 18,
      itemHeight: 3,
      textStyle: { color: text, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 11 },
    },
    tooltip: {
      show: true,
      trigger: 'axis',
      triggerOn: 'mousemove|click|mousewheel',
      confine: true,
      className: 'pourframe-chart-tooltip',
      backgroundColor: withAlpha(surface, 0.96),
      borderColor: grid,
      borderWidth: 1,
      padding: [9, 11],
      textStyle: { color: text, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 11 },
      axisPointer: { type: 'cross', label: { show: false }, lineStyle: { color: axis, type: 'dashed', width: 1 } },
      formatter: tooltipFormatter,
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true, moveOnMouseWheel: false, preventDefaultMouseMove: true, start: 0, end: 100 },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        start: 0,
        end: 100,
        height: 16,
        bottom: 8,
        borderColor: 'transparent',
        backgroundColor: withAlpha(grid, 0.22),
        fillerColor: withAlpha(axis, 0.18),
        handleStyle: { color: surface, borderColor: axis },
        moveHandleStyle: { color: axis },
        dataBackground: { lineStyle: { color: axis, opacity: 0.5 }, areaStyle: { color: axis, opacity: 0.08 } },
        selectedDataBackground: { lineStyle: { color: axis, opacity: 0.72 }, areaStyle: { color: axis, opacity: 0.14 } },
        textStyle: { color: axis, fontSize: 9 },
      },
    ],
    xAxis: {
      type: 'value',
      name: 'Elapsed time (s)',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: axis, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 11, fontWeight: 600 },
      axisLine: { lineStyle: { color: grid } },
      axisTick: { lineStyle: { color: grid } },
      axisLabel: { color: axis, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 10, formatter: (value: number) => value.toFixed(value < 10 ? 1 : 0) },
      splitLine: { lineStyle: { color: grid } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: 'Weight (g)',
      nameLocation: 'middle',
      nameGap: 47,
      nameTextStyle: { color: axis, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 11, fontWeight: 600 },
      axisLine: { show: true, lineStyle: { color: grid } },
      axisTick: { show: true, lineStyle: { color: grid } },
      axisLabel: { color: axis, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 10, formatter: (value: number) => value.toFixed(1) },
      splitLine: { lineStyle: { color: grid } },
    },
    series: captureSeries(columns),
  }
}

export function WeightCapture({ telemetry, online }: WeightCaptureProps) {
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
  const createOption = useCallback(() => buildWeightCaptureOption(columnsRef.current), [])
  const { chartRef, hostRef, scheduleOption } = useEChart(createOption, 'weight-capture')

  const scheduleChartUpdate = useCallback(() => {
    scheduleOption(() => ({ series: captureSeries(columnsRef.current) }))
  }, [scheduleOption])

  const finishCapture = useCallback((detail: string) => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setPhase('stopped')
    setMessage(detail)
    scheduleChartUpdate()
  }, [scheduleChartUpdate])

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
    scheduleChartUpdate()
  }, [finishCapture, scheduleChartUpdate])

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
    scheduleChartUpdate()
    appendTelemetry(telemetry)
  }

  const stopCapture = () => {
    finishCapture('Capture stopped. The data is ready to export.')
  }

  const resetZoom = () => {
    chartRef.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
    setMessage('Chart zoom reset to the full capture.')
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
          <h2 className="metric-title metric-title--summary" id="weight-capture-heading">Weight Capture</h2>
          <p>Record the combined, upper, and lower filtered weights against elapsed time.</p>
        </div>
        <div className="capture-controls" aria-label="Weight capture controls">
          <button className="capture-button capture-button--primary" disabled={!canStart} onClick={startCapture} type="button">Start</button>
          <button className="capture-button" disabled={phase !== 'recording'} onClick={stopCapture} type="button">Stop</button>
          <button className="capture-button" disabled={!canExport} onClick={exportCapture} type="button">Export CSV</button>
        </div>
      </div>

      <dl className="capture-stats">
        <div><dt>Status</dt><dd className={`capture-status capture-status--${phase}${phase === 'recording' && !online ? ' capture-status--waiting' : ''}`}><i aria-hidden="true" />{status}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(progress.elapsedSeconds)}</dd></div>
        <div><dt>Samples</dt><dd>{progress.sampleCount.toLocaleString('en-US')}</dd></div>
      </dl>

      <div className="capture-chart-frame">
        <button className="capture-chart__reset" disabled={progress.sampleCount === 0} onClick={resetZoom} type="button">Reset zoom</button>
        <div aria-label="Elapsed time chart of total, upper, and lower weight in grams" className="capture-chart" ref={hostRef} role="img" />
        {progress.sampleCount === 0 ? <p className="capture-chart__empty">Start a capture to plot live weight data.</p> : null}
      </div>
      <p className="capture-message" role="status">{message}</p>
    </section>
  )
}
