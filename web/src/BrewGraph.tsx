import { useCallback, useEffect, useRef, useState } from 'react'
import type { LineSeriesOption } from 'echarts/charts'
import type { BrewRecipe, BrewStep, StepTransition } from './brewTypes'
import type { BrewTraceBuffer, BrewTraceBufferEvent, BrewTraceSample } from './trace'
import { cssColor, displayP3Color, withAlpha } from './chartTheme'
import { stepCueLeadSeconds } from './brew'
import { useEChart, type PourFrameChartOption } from './echarts'

export type GraphColumns = [number[], Array<number | null>, Array<number | null>, Array<number | null>]

export interface BrewMilestone {
  id: string
  label: string
  elapsedSeconds: number
  targetGrams: number | null
  kind: 'coffee' | 'pour' | 'drawdown'
}

export type BrewGraphVariant = 'card' | 'backdrop'

export interface BrewGraphOptionInput {
  columns: GraphColumns
  milestones: BrewMilestone[]
  variant: BrewGraphVariant
  theme: 'light' | 'dark'
  elapsedSeconds?: number
  timeDomainSeconds?: number
  weightDomainTargetGrams?: number
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

function seriesData(times: number[], values: Array<number | null>): Array<[number, number | null]> {
  return times.map((time, index) => [time, values[index]])
}

interface TooltipDatum {
  axisValue?: number | string
  marker?: string
  seriesName?: string
  value?: unknown
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
  const heading = Number.isFinite(seconds) ? `${seconds.toFixed(seconds < 10 ? 2 : 1)} s` : 'Brew trace'
  const values = rows.map((row) => {
    const value = numericPointValue(row.value)
    return `<div class="pourframe-chart-tooltip__row">${row.marker ?? ''}<span>${row.seriesName ?? 'Weight'}</span><strong>${value == null ? '—' : `${value.toFixed(1)} g`}</strong></div>`
  }).join('')
  return `<div class="pourframe-chart-tooltip__time">${heading}</div>${values}`
}

type MilestonePhase = 'completed' | 'current' | 'imminent' | 'future'

function milestonePhase(milestone: BrewMilestone, milestones: BrewMilestone[], elapsedSeconds?: number): MilestonePhase {
  if (elapsedSeconds == null) return 'future'
  if (milestoneIsImminent(milestone, elapsedSeconds)) return 'imminent'
  const current = milestones.reduce<BrewMilestone | null>((latest, candidate) => {
    if (candidate.elapsedSeconds > elapsedSeconds) return latest
    return latest == null || candidate.elapsedSeconds > latest.elapsedSeconds ? candidate : latest
  }, null)
  if (current?.id === milestone.id) return 'current'
  return milestone.elapsedSeconds < elapsedSeconds ? 'completed' : 'future'
}

function milestoneVisual(milestone: BrewMilestone, milestones: BrewMilestone[], variant: BrewGraphVariant, theme: 'light' | 'dark', elapsedSeconds?: number) {
  if (variant === 'card') return {
    color: milestone.kind === 'coffee' ? cssColor('--app-muted', 'rgba(76, 96, 84, 1)') : cssColor('--app-accent', 'rgba(0, 142, 73, 1)'),
    opacity: 1,
    symbolSize: 7,
    width: 1,
  }

  const phase = milestonePhase(milestone, milestones, elapsedSeconds)
  const green = theme === 'light'
    ? displayP3Color([0, 0.565, 0.275], [0, 142, 73])
    : displayP3Color([0.3, 0.97, 0.49], [77, 247, 125])
  const neutral = theme === 'light'
    ? displayP3Color([0.22, 0.34, 0.27], [65, 89, 73])
    : displayP3Color([0.67, 0.76, 0.7], [171, 194, 179])
  if (phase === 'imminent') return { color: green, opacity: 0.98, symbolSize: 11, width: 2.4 }
  if (phase === 'current') return { color: green, opacity: 0.7, symbolSize: 9, width: 1.7 }
  if (phase === 'completed') return { color: neutral, opacity: 0.16, symbolSize: 6, width: 1 }
  return { color: neutral, opacity: 0.3, symbolSize: 6, width: 1 }
}

function brewSeries({ columns, milestones, variant, theme, elapsedSeconds, weightDomainTargetGrams }: BrewGraphOptionInput): LineSeriesOption[] {
  const backdrop = variant === 'backdrop'
  const total = backdrop
    ? theme === 'light' ? displayP3Color([0, 0.47, 0.24], [38, 120, 68]) : displayP3Color([0.3, 0.97, 0.49], [123, 215, 150])
    : cssColor('--chart-total', 'rgba(255, 105, 20, 1)')
  const upper = backdrop
    ? theme === 'light' ? displayP3Color([0.03, 0.42, 0.53], [40, 113, 139]) : displayP3Color([0.34, 0.52, 1], [138, 199, 223])
    : cssColor('--chart-upper', 'rgba(99, 56, 255, 1)')
  const lower = backdrop
    ? theme === 'light' ? displayP3Color([0.2, 0.47, 0.19], [71, 127, 60]) : displayP3Color([0.63, 0.9, 0.63], [178, 223, 168])
    : cssColor('--chart-lower', 'rgba(0, 188, 78, 1)')
  const lineColors = [total, upper, lower]
  const names = ['Combined', 'Upper', 'Lower']
  const widths = backdrop ? [6.5, 3, 3] : [2.3, 1.8, 1.8]
  const milestoneLines = milestones.map((milestone) => {
    const visual = milestoneVisual(milestone, milestones, variant, theme, elapsedSeconds)
    return {
      name: milestone.label,
      xAxis: milestone.elapsedSeconds,
      lineStyle: { color: visual.color, opacity: visual.opacity, type: 'dashed' as const, width: visual.width },
      label: { show: false },
    }
  })
  const targetLine = backdrop && weightDomainTargetGrams != null && Number.isFinite(weightDomainTargetGrams) && weightDomainTargetGrams > 0
    ? [{
        name: 'Water target',
        yAxis: weightDomainTargetGrams,
        lineStyle: {
          color: theme === 'light'
            ? displayP3Color([0, 0.42, 0.2], [24, 108, 57])
            : displayP3Color([0.55, 1, 0.67], [155, 239, 174]),
          opacity: theme === 'light' ? 0.25 : 0.22,
          type: 'dashed' as const,
          width: 1.2,
        },
        label: { show: false },
      }]
    : []
  const milestonePoints = milestones.filter((milestone) => milestone.targetGrams != null).map((milestone) => {
    const visual = milestoneVisual(milestone, milestones, variant, theme, elapsedSeconds)
    return {
      name: milestone.label,
      coord: [milestone.elapsedSeconds, milestone.targetGrams as number],
      itemStyle: { color: visual.color, opacity: visual.opacity },
      symbolSize: visual.symbolSize,
    }
  })

  return names.map((name, index) => ({
    id: `brew-${name.toLowerCase()}`,
    name,
    type: 'line',
    data: seriesData(columns[0], columns[index + 1]),
    animation: false,
    silent: backdrop,
    smooth: 0.22,
    connectNulls: false,
    showSymbol: false,
    sampling: 'lttb',
    lineStyle: { color: withAlpha(lineColors[index], backdrop ? index === 0 ? 0.96 : 0.5 : 0.92), width: widths[index], cap: 'round', join: 'round' },
    itemStyle: { color: lineColors[index] },
    areaStyle: index === 0 ? { color: withAlpha(total, backdrop ? 0.16 : 0.12), origin: 'start' } : backdrop ? undefined : { color: withAlpha(lineColors[index], 0.08), origin: 'start' },
    emphasis: { disabled: backdrop, focus: 'series' },
    markLine: index === 0 ? { animation: false, data: [...milestoneLines, ...targetLine], silent: true, symbol: ['none', 'none'] } : undefined,
    markPoint: index === 0 ? { animation: false, data: milestonePoints, label: { show: false }, silent: true, symbol: 'circle', symbolSize: 7 } : undefined,
  }))
}

export function buildBrewGraphOption(input: BrewGraphOptionInput): PourFrameChartOption {
  const { columns, variant, timeDomainSeconds, weightDomainTargetGrams } = input
  const backdrop = variant === 'backdrop'
  const axis = cssColor('--app-muted', 'rgba(76, 96, 84, 1)')
  const grid = cssColor('--app-line', 'rgba(15, 22, 18, 0.12)')
  const surface = cssColor('--app-surface', 'rgba(255, 255, 255, 1)')
  const text = cssColor('--app-text', 'rgba(23, 21, 20, 1)')
  const targetDomain = weightDomainForTarget(columns, weightDomainTargetGrams)

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: backdrop
      ? { left: 0, right: 0, top: 0, bottom: 0, containLabel: false }
      : { left: 58, right: 18, top: 52, bottom: 44, containLabel: false },
    legend: {
      show: !backdrop,
      top: 4,
      left: 52,
      selectedMode: true,
      itemWidth: 18,
      itemHeight: 3,
      textStyle: { color: text, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 11 },
    },
    tooltip: {
      show: !backdrop,
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
    xAxis: {
      type: 'value',
      show: !backdrop,
      min: timeDomainSeconds == null ? undefined : 0,
      max: timeDomainSeconds,
      name: backdrop ? undefined : 'Brew time (s)',
      nameLocation: 'middle',
      nameGap: 29,
      nameTextStyle: { color: axis, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 11, fontWeight: 600 },
      axisLine: { lineStyle: { color: grid } },
      axisTick: { lineStyle: { color: grid } },
      axisLabel: { color: axis, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 10, formatter: (value: number) => value.toFixed(value < 10 ? 1 : 0) },
      splitLine: { show: !backdrop, lineStyle: { color: grid } },
    },
    yAxis: {
      type: 'value',
      show: !backdrop,
      scale: targetDomain == null,
      min: targetDomain?.[0],
      max: targetDomain?.[1],
      name: backdrop ? undefined : 'Weight (g)',
      nameLocation: 'middle',
      nameGap: 43,
      nameTextStyle: { color: axis, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 11, fontWeight: 600 },
      axisLine: { show: !backdrop, lineStyle: { color: grid } },
      axisTick: { show: !backdrop, lineStyle: { color: grid } },
      axisLabel: { color: axis, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 10, formatter: (value: number) => value.toFixed(1) },
      splitLine: { show: !backdrop, lineStyle: { color: grid } },
    },
    series: brewSeries(input),
  }
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

export function BrewGraph({ source, samples, milestones, emptyMessage = 'The graph begins automatically when Bloom starts.', compact = false, variant = 'card', decorative = false, timeDomainSeconds, weightDomainTargetGrams, elapsedSeconds, theme = 'dark' }: BrewGraphProps) {
  const columnsRef = useRef<GraphColumns>(samples ? traceColumns(samples) : source ? traceColumns(source.samples()) : emptyColumns())
  const milestonesRef = useRef(milestones)
  const elapsedSecondsRef = useRef(elapsedSeconds)
  const [empty, setEmpty] = useState(!hasPlottableValues(columnsRef.current))
  milestonesRef.current = milestones
  elapsedSecondsRef.current = elapsedSeconds

  const optionInput = useCallback((): BrewGraphOptionInput => ({
    columns: columnsWithinTimeDomain(columnsRef.current, timeDomainSeconds),
    milestones: milestonesRef.current,
    variant,
    theme,
    elapsedSeconds: elapsedSecondsRef.current,
    timeDomainSeconds,
    weightDomainTargetGrams,
  }), [theme, timeDomainSeconds, variant, weightDomainTargetGrams])
  const createOption = useCallback(() => buildBrewGraphOption(optionInput()), [optionInput])
  const lifecycleKey = `${compact}:${variant}:${theme}:${timeDomainSeconds ?? 'auto'}:${weightDomainTargetGrams ?? 'auto'}`
  const { hostRef, scheduleOption } = useEChart(createOption, lifecycleKey)

  const updateChart = useCallback(() => {
    scheduleOption(() => ({ series: brewSeries(optionInput()) }))
  }, [optionInput, scheduleOption])

  const syncEmptyState = useCallback(() => {
    const nextEmpty = !hasPlottableValues(columnsRef.current)
    setEmpty((current) => current === nextEmpty ? current : nextEmpty)
  }, [])

  useEffect(() => {
    if (!samples) return
    columnsRef.current = traceColumns(samples)
    syncEmptyState()
    updateChart()
  }, [samples, syncEmptyState, updateChart])

  useEffect(() => {
    if (!source) return
    columnsRef.current = traceColumns(source.samples())
    syncEmptyState()
    updateChart()
    return source.subscribe((event: BrewTraceBufferEvent) => {
      if (event.type === 'clear') columnsRef.current = emptyColumns()
      else appendColumn(columnsRef.current, event.sample)
      syncEmptyState()
      updateChart()
    })
  }, [source, syncEmptyState, updateChart])

  useEffect(() => { updateChart() }, [elapsedSeconds, milestones, updateChart])

  return <div aria-hidden={decorative || undefined} className={`${compact ? 'brew-graph brew-graph--compact' : 'brew-graph'}${variant === 'backdrop' ? ' brew-graph--backdrop' : ''}`}>
    {variant === 'card' ? <div className="brew-graph__milestones" aria-label="Brew milestones">{milestones.map((milestone) => <span className={`brew-graph__milestone brew-graph__milestone--${milestone.kind}`} key={milestone.id}>{milestone.label}</span>)}</div> : null}
    <div className="brew-graph__drawing"><div aria-label={decorative ? undefined : 'Brew weight graph with recipe milestones'} className="brew-graph__plot" ref={hostRef} role={decorative ? undefined : 'img'} /></div>
    {empty ? <p className="brew-graph__empty">{emptyMessage}</p> : null}
  </div>
}
