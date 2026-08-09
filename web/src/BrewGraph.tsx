import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { BrewRecipe, BrewStep, StepTransition } from './brewTypes'
import type { BrewTraceBuffer, BrewTraceBufferEvent, BrewTraceSample } from './trace'
import { cssColor, withAlpha } from './chartTheme'
import { stepCueLeadSeconds } from './brew'

type GraphColumns = [number[], Array<number | null>, Array<number | null>, Array<number | null>]
const smoothPath = uPlot.paths.spline?.({ alignGaps: 0 })

export interface BrewMilestone {
  id: string
  label: string
  elapsedSeconds: number
  targetGrams: number | null
  kind: 'coffee' | 'pour' | 'drawdown'
}

export type BrewGraphVariant = 'card' | 'backdrop'

function formatTarget(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

export function brewMilestones(recipe: BrewRecipe, schedule: BrewStep[], transitions: StepTransition[]): BrewMilestone[] {
  const transitionByStep = new Map(transitions.filter((item) => item.actual_elapsed_ms != null).map((item) => [item.step_id, item]))
  const milestones: BrewMilestone[] = [{ id: 'coffee', label: `Coffee · ${formatTarget(recipe.coffee)} g`, elapsedSeconds: 0, targetGrams: null, kind: 'coffee' }]
  for (const step of schedule) {
    if (step.kind !== 'pour') continue
    const transition = transitionByStep.get(step.id)
    if (!transition || transition.actual_elapsed_ms == null) continue
    milestones.push({
      id: step.id,
      label: `${step.name} · +${formatTarget(step.pour)} g / ${formatTarget(step.cumulative)} g total`,
      elapsedSeconds: transition.actual_elapsed_ms / 1000,
      targetGrams: step.cumulative,
      kind: 'pour',
    })
  }
  return milestones
}

/** Scheduled focus markers stay visible even when a physical transition is late. */
export function scheduledBrewMilestones(schedule: BrewStep[]): BrewMilestone[] {
  return schedule.map((step) => ({
    id: `scheduled:${step.id}`,
    label: step.name,
    elapsedSeconds: step.start,
    targetGrams: step.cumulative,
    kind: step.kind,
  }))
}

export function milestoneIsImminent(milestone: BrewMilestone, elapsedSeconds?: number) {
  return elapsedSeconds != null && milestone.elapsedSeconds > elapsedSeconds && milestone.elapsedSeconds - elapsedSeconds <= stepCueLeadSeconds
}

function emptyColumns(): GraphColumns { return [[], [], [], []] }
const placeholderColumns: GraphColumns = [[0, 1], [0, 0], [null, null], [null, null]]
function plottableColumns(columns: GraphColumns) { return columns[0].length ? columns : placeholderColumns }
function copyColumns(columns: GraphColumns): GraphColumns { return [columns[0].slice(), columns[1].slice(), columns[2].slice(), columns[3].slice()] }
export function hasPlottableValues(columns: GraphColumns) {
  return columns.slice(1).some((series) => series.some((value) => value != null && Number.isFinite(value)))
}

/**
 * The focus view is a recipe-time composition, not a scrolling monitor. Keep
 * the raw trace intact for saving/history, but expose only its in-target-time
 * portion to that presentation.
 */
export function columnsWithinTimeDomain(columns: GraphColumns, durationSeconds?: number): GraphColumns {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return columns
  const visible = emptyColumns()
  for (let index = 0; index < columns[0].length; index += 1) {
    if (columns[0][index] < 0 || columns[0][index] > durationSeconds) continue
    visible[0].push(columns[0][index])
    visible[1].push(columns[1][index])
    visible[2].push(columns[2][index])
    visible[3].push(columns[3][index])
  }
  return visible
}

function weightDomainFromExtent(minimum: number, maximum: number, targetGrams?: number): [number, number] {
  if (targetGrams == null || !Number.isFinite(targetGrams) || targetGrams <= 0) return [minimum, maximum]
  const belowZero = minimum < 0
  const aboveTarget = maximum > targetGrams
  if (!belowZero && !aboveTarget) return [0, targetGrams]
  const span = Math.max(targetGrams, maximum) - Math.min(0, minimum)
  const padding = Math.max(2, span * 0.04)
  return [belowZero ? minimum - padding : 0, aboveTarget ? maximum + padding : targetGrams]
}

/** The focus backdrop keeps the recipe target as its normal vertical frame. */
export function weightDomainForTarget(columns: GraphColumns, targetGrams?: number): [number, number] | null {
  let minimum = Infinity
  let maximum = -Infinity
  for (const series of columns.slice(1)) {
    for (const value of series) {
      if (value == null || !Number.isFinite(value)) continue
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
  }
  return minimum === Infinity ? null : weightDomainFromExtent(minimum, maximum, targetGrams)
}

function appendColumn(columns: GraphColumns, sample: BrewTraceSample) {
  columns[0].push(sample.elapsedMs / 1000)
  columns[1].push(Number.isFinite(sample.total) ? sample.total : null)
  columns[2].push(Number.isFinite(sample.upper) ? sample.upper : null)
  columns[3].push(Number.isFinite(sample.lower) ? sample.lower : null)
}

export function traceColumns(samples: BrewTraceSample[]) {
  const columns = emptyColumns()
  samples.forEach((sample) => appendColumn(columns, sample))
  return columns
}

function milestonePlugin(getMilestones: () => BrewMilestone[], getElapsedSeconds: () => number | undefined, variant: BrewGraphVariant, theme: 'light' | 'dark'): uPlot.Plugin {
  return {
    hooks: {
      draw: [(plot) => {
        const { ctx, bbox } = plot
        const milestones = getMilestones()
        ctx.save()
        ctx.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif'
        for (const [index, milestone] of milestones.entries()) {
          const x = plot.valToPos(milestone.elapsedSeconds, 'x', true)
          if (x < bbox.left || x > bbox.left + bbox.width) continue
          const imminent = milestoneIsImminent(milestone, getElapsedSeconds())
          const markerColor = variant === 'backdrop'
            ? theme === 'light'
              ? imminent ? 'rgba(22, 101, 52, .94)' : 'rgba(22, 101, 52, .52)'
              : imminent ? 'rgba(123, 215, 150, .96)' : 'rgba(174, 179, 170, .38)'
            : milestone.kind === 'coffee' ? cssColor('--app-muted', '#76706b') : cssColor('--app-accent', '#9c4d25')
          ctx.strokeStyle = markerColor
          ctx.fillStyle = ctx.strokeStyle
          ctx.setLineDash([4, 4])
          ctx.beginPath(); ctx.moveTo(x, bbox.top); ctx.lineTo(x, bbox.top + bbox.height); ctx.stroke()
          ctx.setLineDash([])
          if (milestone.targetGrams != null) {
            const y = plot.valToPos(milestone.targetGrams, 'y', true)
            if (y >= bbox.top && y <= bbox.top + bbox.height) {
              ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
            }
          }
          if (variant === 'backdrop') {
            continue
          }
          const width = Math.ceil(ctx.measureText(milestone.label).width) + 12
          const labelX = Math.max(bbox.left, Math.min(x + 5, bbox.left + bbox.width - width))
          const labelY = bbox.top + 5 + (index % 3) * 18
          ctx.globalAlpha = 0.9
          ctx.fillStyle = cssColor('--app-surface', '#fff')
          ctx.fillRect(labelX, labelY, width, 16)
          ctx.globalAlpha = 1
          ctx.fillStyle = milestone.kind === 'coffee' ? cssColor('--app-muted', '#76706b') : cssColor('--app-accent', '#9c4d25')
          ctx.fillText(milestone.label, labelX + 6, labelY + 12)
        }
        ctx.restore()
      }],
    },
  }
}

function graphOptions(width: number, height: number, getMilestones: () => BrewMilestone[], getElapsedSeconds: () => number | undefined, variant: BrewGraphVariant, theme: 'light' | 'dark', timeDomainSeconds?: number, weightDomainTargetGrams?: number): uPlot.Options {
  const value = (_plot: uPlot, raw: number | null) => raw == null ? '—' : `${raw.toFixed(1)} g`
  const total = variant === 'backdrop' ? theme === 'light' ? '#267844' : '#7bd796' : cssColor('--chart-total', '#512612')
  const upper = variant === 'backdrop' ? theme === 'light' ? '#28718b' : '#8ac7df' : cssColor('--chart-upper', '#336b8e')
  const lower = variant === 'backdrop' ? theme === 'light' ? '#477f3c' : '#b2dfa8' : cssColor('--chart-lower', '#247a36')
  const axis = cssColor('--app-muted', '#76706b')
  const grid = cssColor('--app-line', '#dedbd8')
  return {
    width, height,
    scales: {
      x: { time: false, range: timeDomainSeconds == null ? undefined : [0, timeDomainSeconds] },
      y: { range: weightDomainTargetGrams == null ? undefined : (_plot, minimum, maximum) => weightDomainFromExtent(minimum, maximum, weightDomainTargetGrams) },
    },
    cursor: variant === 'backdrop' ? { show: false } : { drag: { setScale: false, x: false, y: false }, focus: { prox: 30 } },
    legend: { show: variant === 'card', live: true },
    series: [
      { label: 'Time', value: (_plot, raw) => raw == null ? '—' : `${raw.toFixed(1)} s` },
      { label: 'Combined', paths: smoothPath, stroke: variant === 'backdrop' ? 'transparent' : withAlpha(total, 0.92), fill: variant === 'backdrop' ? 'transparent' : withAlpha(total, 0.12), fillTo: (plot) => plot.scales.y?.min ?? 0, width: variant === 'backdrop' ? 0 : 2.3, spanGaps: false, points: { show: false }, value },
      { label: 'Upper', paths: smoothPath, stroke: variant === 'backdrop' ? 'transparent' : withAlpha(upper, 0.88), fill: variant === 'backdrop' ? 'transparent' : withAlpha(upper, 0.1), fillTo: (plot) => plot.scales.y?.min ?? 0, width: variant === 'backdrop' ? 0 : 1.8, spanGaps: false, points: { show: false }, value },
      { label: 'Lower', paths: smoothPath, stroke: variant === 'backdrop' ? 'transparent' : withAlpha(lower, 0.88), fill: variant === 'backdrop' ? 'transparent' : withAlpha(lower, 0.1), fillTo: (plot) => plot.scales.y?.min ?? 0, width: variant === 'backdrop' ? 0 : 1.8, spanGaps: false, points: { show: false }, value },
    ],
    axes: variant === 'backdrop' ? [
      { show: false, grid: { show: false }, ticks: { show: false } },
      { show: false, grid: { show: false }, ticks: { show: false } },
    ] : [
      { label: 'Brew time (s)', stroke: axis, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, values: (_plot, ticks) => ticks.map((tick) => tick.toFixed(tick < 10 ? 1 : 0)) },
      { label: 'Weight (g)', stroke: axis, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, values: (_plot, ticks) => ticks.map((tick) => tick.toFixed(1)), size: 58 },
    ],
    plugins: [milestonePlugin(getMilestones, getElapsedSeconds, variant, theme)],
  }
}

function tracePath(times: number[], values: Array<number | null>, minX: number, maxX: number, minY: number, maxY: number, width: number, height: number) {
  const xSpan = Math.max(1, maxX - minX)
  const ySpan = Math.max(1, maxY - minY)
  let path = ''
  let drawing = false
  for (let index = 0; index < times.length; index += 1) {
    const value = values[index]
    if (value == null || !Number.isFinite(value)) { drawing = false; continue }
    const x = ((times[index] - minX) / xSpan) * width
    const y = height - ((value - minY) / ySpan) * height
    path += `${drawing ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
    drawing = true
  }
  return path
}

function traceAreaPath(times: number[], values: Array<number | null>, minX: number, maxX: number, minY: number, maxY: number, width: number, height: number) {
  const xSpan = Math.max(1, maxX - minX)
  const ySpan = Math.max(1, maxY - minY)
  let path = ''
  let firstX = 0
  let lastX = 0
  let drawing = false
  for (let index = 0; index < times.length; index += 1) {
    const value = values[index]
    if (value == null || !Number.isFinite(value)) {
      if (drawing) path += `L${lastX.toFixed(2)},${height.toFixed(2)}L${firstX.toFixed(2)},${height.toFixed(2)}Z`
      drawing = false
      continue
    }
    const x = ((times[index] - minX) / xSpan) * width
    const y = height - ((value - minY) / ySpan) * height
    if (!drawing) {
      firstX = x
      path += `M${x.toFixed(2)},${height.toFixed(2)}L${x.toFixed(2)},${y.toFixed(2)}`
      drawing = true
    } else {
      path += `L${x.toFixed(2)},${y.toFixed(2)}`
    }
    lastX = x
  }
  if (drawing) path += `L${lastX.toFixed(2)},${height.toFixed(2)}L${firstX.toFixed(2)},${height.toFixed(2)}Z`
  return path
}

function TraceOverlay({ columns, variant, timeDomainSeconds, weightDomainTargetGrams, frame }: { columns: GraphColumns; variant: BrewGraphVariant; timeDomainSeconds?: number; weightDomainTargetGrams?: number; frame: PlotFrame }) {
  const finiteValues: number[] = []
  for (const series of columns.slice(1)) for (const value of series) if (value != null && Number.isFinite(value)) finiteValues.push(value)
  if (!finiteValues.length || !columns[0].length) return null
  const minX = timeDomainSeconds == null ? Math.min(...columns[0]) : 0
  const maxX = timeDomainSeconds == null ? Math.max(...columns[0]) : timeDomainSeconds
  const dataMin = Math.min(...finiteValues)
  const dataMax = Math.max(...finiteValues)
  const targetDomain = weightDomainForTarget(columns, weightDomainTargetGrams)
  const padding = Math.max(2, (dataMax - dataMin) * 0.08)
  const [minY, maxY] = targetDomain ?? [Math.max(0, dataMin - padding), dataMax + padding]
  return <svg aria-hidden="true" className={`brew-graph__trace brew-graph__trace--${variant}`} style={{ bottom: 'auto', height: frame.height, left: frame.left, right: 'auto', top: frame.top, width: frame.width }} viewBox={`0 0 ${frame.width} ${frame.height}`}>
    {variant === 'backdrop' ? <path className="brew-graph__trace-area" d={traceAreaPath(columns[0], columns[1], minX, maxX, minY, maxY, frame.width, frame.height)} /> : null}
    <path className="brew-graph__trace-total" d={tracePath(columns[0], columns[1], minX, maxX, minY, maxY, frame.width, frame.height)} vectorEffect="non-scaling-stroke" />
    <path className="brew-graph__trace-upper" d={tracePath(columns[0], columns[2], minX, maxX, minY, maxY, frame.width, frame.height)} vectorEffect="non-scaling-stroke" />
    <path className="brew-graph__trace-lower" d={tracePath(columns[0], columns[3], minX, maxX, minY, maxY, frame.width, frame.height)} vectorEffect="non-scaling-stroke" />
  </svg>
}

interface BrewGraphProps {
  source?: BrewTraceBuffer
  samples?: BrewTraceSample[]
  milestones: BrewMilestone[]
  emptyMessage?: string
  compact?: boolean
  variant?: BrewGraphVariant
  decorative?: boolean
  /** Fixed 0…duration x-axis for the focus backdrop only. */
  timeDomainSeconds?: number
  /** Fixed 0…target y-axis for the focus backdrop unless real data exceeds it. */
  weightDomainTargetGrams?: number
  /** Current session time; scheduled focus markers become prominent in the cue window. */
  elapsedSeconds?: number
  theme?: 'light' | 'dark'
}

interface PlotFrame {
  left: number
  top: number
  width: number
  height: number
}

export function BrewGraph({ source, samples, milestones, emptyMessage = 'The graph begins automatically when Bloom starts.', compact = false, variant = 'card', decorative = false, timeDomainSeconds, weightDomainTargetGrams, elapsedSeconds, theme = 'dark' }: BrewGraphProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)
  const columnsRef = useRef<GraphColumns>(samples ? traceColumns(samples) : source ? traceColumns(source.samples()) : emptyColumns())
  const milestonesRef = useRef(milestones)
  const elapsedSecondsRef = useRef(elapsedSeconds)
  const frameRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const [empty, setEmpty] = useState(!hasPlottableValues(columnsRef.current))
  const [renderColumns, setRenderColumns] = useState<GraphColumns>(() => copyColumns(columnsRef.current))
  const [plotFrame, setPlotFrame] = useState<PlotFrame>({ left: 0, top: 0, width: 0, height: 0 })
  milestonesRef.current = milestones
  elapsedSecondsRef.current = elapsedSeconds

  const syncRenderedColumns = useCallback(() => setRenderColumns(copyColumns(columnsRef.current)), [])
  const plotColumns = useCallback(() => plottableColumns(columnsWithinTimeDomain(columnsRef.current, timeDomainSeconds)), [timeDomainSeconds])
  const syncPlotFrame = useCallback(() => {
    const plot = plotRef.current
    if (!plot) return
    const nextFrame = { left: plot.bbox.left, top: plot.bbox.top, width: plot.bbox.width, height: plot.bbox.height }
    setPlotFrame((current) => current.left === nextFrame.left && current.top === nextFrame.top && current.width === nextFrame.width && current.height === nextFrame.height ? current : nextFrame)
  }, [])

  const updatePlot = useCallback(() => {
    if (frameRef.current != null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      plotRef.current?.setData(plotColumns())
      syncPlotFrame()
    })
  }, [plotColumns, syncPlotFrame])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const size = () => ({
      width: Math.max(280, Math.floor(host.getBoundingClientRect().width)),
      height: variant === 'backdrop' ? Math.max(280, Math.floor(host.getBoundingClientRect().height)) : compact ? 230 : 300,
    })
    const initialSize = size()
    // Start with a valid two-point shape, then hydrate it from the source or
    // saved samples in the data effects below. This avoids relying on the
    // first render's columns when a history trace arrives asynchronously.
    plotRef.current = new uPlot(graphOptions(initialSize.width, initialSize.height, () => milestonesRef.current, () => elapsedSecondsRef.current, variant, theme, timeDomainSeconds, weightDomainTargetGrams), placeholderColumns, host)
    syncPlotFrame()
    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current != null) return
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null
        const nextSize = size()
        if (plotRef.current && (plotRef.current.width !== nextSize.width || plotRef.current.height !== nextSize.height)) {
          plotRef.current.setSize(nextSize)
          syncPlotFrame()
        }
      })
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current)
      plotRef.current?.destroy(); plotRef.current = null
    }
  }, [compact, syncPlotFrame, theme, timeDomainSeconds, variant, weightDomainTargetGrams])

  useEffect(() => {
    if (!samples) return
    columnsRef.current = traceColumns(samples)
    setEmpty(!hasPlottableValues(columnsRef.current))
    syncRenderedColumns()
    updatePlot()
  }, [samples, syncRenderedColumns, updatePlot])

  useEffect(() => {
    if (!source) return
    columnsRef.current = traceColumns(source.samples())
    setEmpty(!hasPlottableValues(columnsRef.current))
    syncRenderedColumns()
    updatePlot()
    return source.subscribe((event: BrewTraceBufferEvent) => {
      if (event.type === 'clear') {
        columnsRef.current = emptyColumns(); setEmpty(true)
      } else {
        appendColumn(columnsRef.current, event.sample)
        setEmpty(!hasPlottableValues(columnsRef.current))
      }
      syncRenderedColumns()
      updatePlot()
    })
  }, [source, syncRenderedColumns, theme, updatePlot])

  useEffect(() => { plotRef.current?.redraw() }, [elapsedSeconds, milestones])

  return <div aria-hidden={decorative || undefined} className={`${compact ? 'brew-graph brew-graph--compact' : 'brew-graph'}${variant === 'backdrop' ? ' brew-graph--backdrop' : ''}`}>
    {variant === 'card' ? <div className="brew-graph__milestones" aria-label="Brew milestones">{milestones.map((milestone) => <span className={`brew-graph__milestone brew-graph__milestone--${milestone.kind}`} key={milestone.id}>{milestone.label}</span>)}</div> : null}
    <div className="brew-graph__drawing"><div aria-label={decorative ? undefined : 'Brew weight graph with recipe milestones'} className="brew-graph__plot" ref={hostRef} role={decorative ? undefined : 'img'} />{plotFrame.width > 0 && plotFrame.height > 0 ? <TraceOverlay columns={columnsWithinTimeDomain(renderColumns, timeDomainSeconds)} frame={plotFrame} timeDomainSeconds={timeDomainSeconds} variant={variant} weightDomainTargetGrams={weightDomainTargetGrams} /> : null}</div>
    {empty ? <p className="brew-graph__empty">{emptyMessage}</p> : null}
  </div>
}
