import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { BrewRecipe, BrewStep, StepTransition } from './brewTypes'
import type { BrewTraceBuffer, BrewTraceBufferEvent, BrewTraceSample } from './trace'

type GraphColumns = [number[], Array<number | null>, Array<number | null>, Array<number | null>]

export interface BrewMilestone {
  id: string
  label: string
  elapsedSeconds: number
  targetGrams: number | null
  kind: 'coffee' | 'pour'
}

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

function emptyColumns(): GraphColumns { return [[], [], [], []] }
const placeholderColumns: GraphColumns = [[0, 1], [0, 0], [null, null], [null, null]]
function plottableColumns(columns: GraphColumns) { return columns[0].length ? columns : placeholderColumns }

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

function cssColor(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function milestonePlugin(getMilestones: () => BrewMilestone[]): uPlot.Plugin {
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
          ctx.strokeStyle = milestone.kind === 'coffee' ? cssColor('--app-muted', '#76706b') : cssColor('--app-accent', '#9c4d25')
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

function graphOptions(width: number, height: number, getMilestones: () => BrewMilestone[]): uPlot.Options {
  const value = (_plot: uPlot, raw: number | null) => raw == null ? '—' : `${raw.toFixed(1)} g`
  const axis = cssColor('--app-muted', '#76706b')
  const grid = cssColor('--app-line', '#dedbd8')
  return {
    width, height,
    scales: { x: { time: false } },
    cursor: { drag: { setScale: false, x: false, y: false }, focus: { prox: 30 } },
    legend: { show: true, live: true },
    series: [
      { label: 'Time', value: (_plot, raw) => raw == null ? '—' : `${raw.toFixed(1)} s` },
      { label: 'Combined', stroke: cssColor('--chart-total', '#512612'), width: 2.5, spanGaps: false, points: { show: false }, value },
      { label: 'Upper', stroke: cssColor('--chart-upper', '#336b8e'), width: 1.5, dash: [9, 5], spanGaps: false, points: { show: false }, value },
      { label: 'Lower', stroke: cssColor('--chart-lower', '#247a36'), width: 1.5, dash: [2, 5], spanGaps: false, points: { show: false }, value },
    ],
    axes: [
      { label: 'Brew time (s)', stroke: axis, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, values: (_plot, ticks) => ticks.map((tick) => tick.toFixed(tick < 10 ? 1 : 0)) },
      { label: 'Weight (g)', stroke: axis, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, values: (_plot, ticks) => ticks.map((tick) => tick.toFixed(1)), size: 58 },
    ],
    plugins: [milestonePlugin(getMilestones)],
  }
}

interface BrewGraphProps {
  source?: BrewTraceBuffer
  samples?: BrewTraceSample[]
  milestones: BrewMilestone[]
  emptyMessage?: string
  compact?: boolean
}

export function BrewGraph({ source, samples, milestones, emptyMessage = 'The graph begins automatically when Bloom starts.', compact = false }: BrewGraphProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const plotRef = useRef<uPlot | null>(null)
  const columnsRef = useRef<GraphColumns>(samples ? traceColumns(samples) : source ? traceColumns(source.samples()) : emptyColumns())
  const milestonesRef = useRef(milestones)
  const frameRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const [empty, setEmpty] = useState(columnsRef.current[0].length === 0)
  milestonesRef.current = milestones

  const updatePlot = useCallback(() => {
    if (frameRef.current != null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      plotRef.current?.setData(plottableColumns(columnsRef.current))
    })
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const height = compact ? 230 : 300
    plotRef.current = new uPlot(graphOptions(Math.max(280, Math.floor(host.getBoundingClientRect().width)), height, () => milestonesRef.current), plottableColumns(columnsRef.current), host)
    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current != null) return
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null
        const width = Math.floor(host.getBoundingClientRect().width)
        if (width > 0 && plotRef.current && plotRef.current.width !== width) plotRef.current.setSize({ width, height })
      })
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      if (resizeFrameRef.current != null) cancelAnimationFrame(resizeFrameRef.current)
      plotRef.current?.destroy(); plotRef.current = null
    }
  }, [compact])

  useEffect(() => {
    if (!source) return
    columnsRef.current = traceColumns(source.samples())
    setEmpty(columnsRef.current[0].length === 0)
    updatePlot()
    return source.subscribe((event: BrewTraceBufferEvent) => {
      if (event.type === 'clear') {
        columnsRef.current = emptyColumns(); setEmpty(true)
      } else {
        appendColumn(columnsRef.current, event.sample)
        if (columnsRef.current[0].length === 1) setEmpty(false)
      }
      updatePlot()
    })
  }, [source, updatePlot])

  useEffect(() => { plotRef.current?.redraw() }, [milestones])

  return <div className={compact ? 'brew-graph brew-graph--compact' : 'brew-graph'}>
    <div className="brew-graph__milestones" aria-label="Brew milestones">{milestones.map((milestone) => <span className={`brew-graph__milestone brew-graph__milestone--${milestone.kind}`} key={milestone.id}>{milestone.label}</span>)}</div>
    <div className="brew-graph__plot" aria-label="Brew weight graph with recipe milestones" ref={hostRef} role="img" />
    {empty ? <p className="brew-graph__empty">{emptyMessage}</p> : null}
  </div>
}
