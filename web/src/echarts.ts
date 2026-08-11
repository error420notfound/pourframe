import { useCallback, useEffect, useRef } from 'react'
import { LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  type DataZoomComponentOption,
  type GridComponentOption,
  type LegendComponentOption,
  type MarkLineComponentOption,
  type MarkPointComponentOption,
  type TooltipComponentOption,
} from 'echarts/components'
import { init, use, type ComposeOption, type EChartsType, type SetOptionOpts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  DataZoomComponent,
  CanvasRenderer,
])

export type PourFrameChartOption = ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | MarkLineComponentOption
  | MarkPointComponentOption
  | DataZoomComponentOption
>

interface PendingUpdate {
  createOption: () => PourFrameChartOption
  settings?: SetOptionOpts
}

/**
 * Owns the imperative ECharts lifecycle without putting high-frequency chart
 * data into React state. Updates and ResizeObserver callbacks are each batched
 * to one operation per animation frame.
 */
export function useEChart(createInitialOption: () => PourFrameChartOption, lifecycleKey: string) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const initialOptionRef = useRef(createInitialOption)
  const updateFrameRef = useRef<number | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const pendingUpdateRef = useRef<PendingUpdate | null>(null)
  initialOptionRef.current = createInitialOption

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const chart = init(host, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    chart.setOption(initialOptionRef.current(), { notMerge: true })

    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current !== null) return
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        if (host.clientWidth > 0 && host.clientHeight > 0) chart.resize()
      })
    })
    observer.observe(host)
    const themeHost = host.closest('[data-theme]')
    const themeObserver = themeHost ? new MutationObserver(() => {
      chart.setOption(initialOptionRef.current(), { notMerge: true })
    }) : null
    if (themeHost) themeObserver?.observe(themeHost, { attributeFilter: ['data-theme'], attributes: true })

    return () => {
      observer.disconnect()
      themeObserver?.disconnect()
      if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current)
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
      updateFrameRef.current = null
      resizeFrameRef.current = null
      pendingUpdateRef.current = null
      chart.dispose()
      chartRef.current = null
    }
  }, [lifecycleKey])

  const scheduleOption = useCallback((createOption: () => PourFrameChartOption, settings?: SetOptionOpts) => {
    pendingUpdateRef.current = { createOption, settings }
    if (updateFrameRef.current !== null) return
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null
      const pending = pendingUpdateRef.current
      pendingUpdateRef.current = null
      if (!pending || !chartRef.current) return
      chartRef.current.setOption(pending.createOption(), pending.settings ?? { lazyUpdate: true, replaceMerge: ['series'] })
    })
  }, [])

  return { chartRef, hostRef, scheduleOption }
}
