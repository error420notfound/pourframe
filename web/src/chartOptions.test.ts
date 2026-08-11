import { describe, expect, it } from 'vitest'
import { buildBrewGraphOption, type BrewGraphOptionInput, type BrewMilestone, type GraphColumns } from './BrewGraph'
import { buildWeightCaptureOption, type CaptureColumns } from './WeightCapture'

const columns: GraphColumns = [[0, 30], [0, 60], [0, 35], [0, 25]]
const milestone: BrewMilestone = {
  id: 'pour-1',
  label: 'Pour 1 · +60 g / 60 g total',
  elapsedSeconds: 30,
  targetGrams: 60,
  kind: 'pour',
}

const backdropMilestones: BrewMilestone[] = [
  { id: 'bloom', label: 'Bloom', elapsedSeconds: 0, targetGrams: 60, kind: 'pour' },
  { id: 'pour-1', label: 'Pour 1', elapsedSeconds: 20, targetGrams: 125, kind: 'pour' },
  { id: 'pour-2', label: 'Pour 2', elapsedSeconds: 30, targetGrams: 190, kind: 'pour' },
  { id: 'drawdown', label: 'Drawdown', elapsedSeconds: 60, targetGrams: 320, kind: 'drawdown' },
]

function brewInput(overrides: Partial<BrewGraphOptionInput> = {}): BrewGraphOptionInput {
  return {
    columns,
    milestones: [milestone],
    variant: 'card',
    theme: 'dark',
    ...overrides,
  }
}

describe('Apache ECharts option builders', () => {
  it('adds milestone lines and target points to an inspectable brew card', () => {
    const option = buildBrewGraphOption(brewInput())
    const series = option.series as Array<{ markLine?: { data?: unknown[] }; markPoint?: { data?: unknown[] } }>
    expect(option.tooltip).toMatchObject({ show: true, trigger: 'axis' })
    expect(option.legend).toMatchObject({ show: true })
    expect(option.dataZoom).toBeUndefined()
    expect(series[0].markLine?.data).toHaveLength(1)
    expect(series[0].markPoint?.data).toHaveLength(1)
  })

  it('keeps the fullscreen chart decorative and adds a subtle water-target reference', () => {
    const option = buildBrewGraphOption(brewInput({
      elapsedSeconds: 26,
      milestones: backdropMilestones,
      variant: 'backdrop',
      timeDomainSeconds: 180,
      weightDomainTargetGrams: 320,
    }))
    const series = option.series as Array<{
      silent?: boolean
      markLine?: { data?: Array<{ xAxis?: number; yAxis?: number; label?: { show?: boolean }; lineStyle?: { opacity?: number; width?: number } }> }
    }>
    expect(option.tooltip).toMatchObject({ show: false })
    expect(option.legend).toMatchObject({ show: false })
    expect(option.dataZoom).toBeUndefined()
    expect(option.xAxis).toMatchObject({ show: false, min: 0, max: 180 })
    expect(option.yAxis).toMatchObject({ show: false, min: 0, max: 320 })
    expect(series.every((item) => item.silent)).toBe(true)

    const lines = series[0].markLine?.data ?? []
    expect(lines.find((line) => line.yAxis === 320)).toMatchObject({
      label: { show: false },
      lineStyle: { opacity: 0.22, width: 1.2 },
    })
    expect(lines.filter((line) => line.xAxis != null)).toHaveLength(backdropMilestones.length)
  })

  it('mutes completed backdrop milestones and emphasizes current and imminent cues', () => {
    const option = buildBrewGraphOption(brewInput({
      elapsedSeconds: 26,
      milestones: backdropMilestones,
      variant: 'backdrop',
      timeDomainSeconds: 180,
      weightDomainTargetGrams: 320,
    }))
    const series = option.series as Array<{
      markLine?: { data?: Array<{ xAxis?: number; lineStyle?: { opacity?: number; width?: number } }> }
    }>
    const lines = series[0].markLine?.data ?? []
    const at = (seconds: number) => lines.find((line) => line.xAxis === seconds)?.lineStyle

    expect(at(0)).toMatchObject({ opacity: 0.16, width: 1 })
    expect(at(20)).toMatchObject({ opacity: 0.7, width: 1.7 })
    expect(at(30)).toMatchObject({ opacity: 0.98, width: 2.4 })
    expect(at(60)).toMatchObject({ opacity: 0.3, width: 1 })
  })

  it('enables inside and slider zoom only for diagnostic capture', () => {
    const captureColumns: CaptureColumns = [[0, 1], [10, 11], [6, 7], [4, 4]]
    const option = buildWeightCaptureOption(captureColumns)
    expect(option.tooltip).toMatchObject({ show: true, trigger: 'axis' })
    expect(option.dataZoom).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'inside' }),
      expect.objectContaining({ type: 'slider' }),
    ]))
  })
})
