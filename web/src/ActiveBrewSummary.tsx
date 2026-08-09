import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowsPointingInIcon as Minimize2, PauseIcon as Pause, PlayIcon as Play, SpeakerWaveIcon as Volume2, SpeakerXMarkIcon as VolumeX, StopIcon as Square } from '@heroicons/react/24/solid'
import { deriveActiveBrewSummary } from './brewSummaryModel'
import { formatRecipeWeight, formatTime } from './brew'
import { liveScaleTelemetry, type BrewMachineState } from './brewMachine'
import type { BrewMode, BrewRecipe, BrewStatus, BrewStep } from './brewTypes'
import { BrewGraph, type BrewMilestone } from './BrewGraph'
import type { BrewTraceBuffer } from './trace'
import type { DeviceTelemetry } from './types'

export interface ActiveBrewSummaryProps {
  recipe: BrewRecipe
  schedule: BrewStep[]
  status: BrewStatus
  elapsed: number
  fullscreenActive: boolean
  dark: boolean
  mode: BrewMode
  telemetry: DeviceTelemetry | null
  machine: BrewMachineState
  message: string
  sound: boolean
  traceBuffer: BrewTraceBuffer
  milestones: BrewMilestone[]
  onPauseResume: () => void
  onEnd: () => Promise<void>
  onToggleSound: () => void
  onExit: () => void
}

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function formatWeight(value: number) {
  const rounded = Math.round(value * 10) / 10
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1)
}

export function ActiveBrewSummary({
  recipe,
  schedule,
  status,
  elapsed,
  fullscreenActive,
  dark,
  mode,
  telemetry,
  machine,
  message,
  sound,
  traceBuffer,
  milestones,
  onPauseResume,
  onEnd,
  onToggleSound,
  onExit,
}: ActiveBrewSummaryProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const primaryActionRef = useRef<HTMLButtonElement | null>(null)
  const exitButtonRef = useRef<HTMLButtonElement | null>(null)
  const endButtonRef = useRef<HTMLButtonElement | null>(null)
  const confirmRef = useRef<HTMLElement | null>(null)
  const cancelEndRef = useRef<HTMLButtonElement | null>(null)
  const fullscreenWasActiveRef = useRef(Boolean(document.fullscreenElement))
  const confirmingEndRef = useRef(false)
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const summary = deriveActiveBrewSummary({ recipe, schedule, status, elapsed, mode, telemetry, machine })
  const complete = status === 'complete'
  const paused = status === 'paused'
  const currentStageIndex = Math.max(0, milestones.findIndex((milestone) => milestone.id === `scheduled:${summary.step.id}`))
  const stagePosition = (milestone: BrewMilestone) => Math.min(100, Math.max(0, (milestone.elapsedSeconds / recipe.brewTime) * 100))
  const currentStagePosition = stagePosition(milestones[currentStageIndex] ?? milestones[0])
  const currentStageEdge = currentStagePosition === 0 ? 'start' : currentStagePosition === 100 ? 'end' : 'middle'
  confirmingEndRef.current = confirmingEnd

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    onExit()
  }, [onExit])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const documentElementHadFocusClass = document.documentElement.classList.contains('focus-view-active')
    const bodyHadFocusClass = document.body.classList.contains('focus-view-active')
    const appliance = document.querySelector<HTMLElement>('.appliance')
    const applianceWasInert = appliance?.hasAttribute('inert') ?? false
    const previousAriaHidden = appliance?.getAttribute('aria-hidden')
    document.body.style.overflow = 'hidden'
    document.documentElement.classList.add('focus-view-active')
    document.body.classList.add('focus-view-active')
    appliance?.setAttribute('inert', '')
    appliance?.setAttribute('aria-hidden', 'true')
    primaryActionRef.current?.focus()

    const onFullscreenChange = () => {
      if (document.fullscreenElement) fullscreenWasActiveRef.current = true
      else if (fullscreenWasActiveRef.current) onExit()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (confirmingEndRef.current) {
          setConfirmingEnd(false)
          requestAnimationFrame(() => endButtonRef.current?.focus())
        } else {
          exit()
        }
        return
      }
      if (event.key !== 'Tab') return
      const scope = confirmingEndRef.current ? confirmRef.current : overlayRef.current
      if (!scope) return
      const focusable = Array.from(scope.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      if (!documentElementHadFocusClass) document.documentElement.classList.remove('focus-view-active')
      if (!bodyHadFocusClass) document.body.classList.remove('focus-view-active')
      if (appliance) {
        if (!applianceWasInert) appliance.removeAttribute('inert')
        if (previousAriaHidden == null) appliance.removeAttribute('aria-hidden')
        else appliance.setAttribute('aria-hidden', previousAriaHidden)
      }
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [exit, onExit])

  useEffect(() => {
    if (complete) exitButtonRef.current?.focus()
  }, [complete])

  const requestEnd = () => {
    setConfirmingEnd(true)
    requestAnimationFrame(() => cancelEndRef.current?.focus())
  }

  const cancelEnd = () => {
    setConfirmingEnd(false)
    requestAnimationFrame(() => endButtonRef.current?.focus())
  }

  const confirmEnd = async () => {
    if (ending) return
    setEnding(true)
    try {
      await onEnd()
      setConfirmingEnd(false)
    } finally {
      setEnding(false)
    }
  }

  const remainingCopy = summary.remainingWater == null
    ? summary.weightState === 'timer_only'
      ? 'Timer-only brew · weight unavailable'
      : liveScaleTelemetry(telemetry)
        ? 'Waiting for synchronized scale data'
        : 'Scale connection unavailable'
    : summary.remainingWater > 0
      ? `${formatWeight(summary.remainingWater)} g remaining`
      : `${formatWeight(Math.abs(summary.remainingWater))} g over target`

  return createPortal(
    <div
      aria-describedby="active-brew-summary-description"
      aria-labelledby="active-brew-summary-title"
      aria-modal="true"
      className="active-brew-summary"
      data-theme={dark ? 'dark' : 'light'}
      data-display-mode={fullscreenActive ? 'fullscreen' : 'focus'}
      ref={overlayRef}
      role="dialog"
    >
      <div className="active-brew-summary__graph" aria-hidden="true"><BrewGraph decorative elapsedSeconds={elapsed} emptyMessage="Live graph begins with Bloom." milestones={milestones} source={traceBuffer} theme={dark ? 'dark' : 'light'} timeDomainSeconds={recipe.brewTime} variant="backdrop" weightDomainTargetGrams={recipe.water} /></div>
      <div aria-hidden="true" className="active-brew-summary__stage-rail">
        <div className="active-brew-summary__stage-rail-line" />
        {milestones.map((milestone) => {
          const position = stagePosition(milestone)
          const edge = position === 0 ? 'start' : position === 100 ? 'end' : 'middle'
          return <div className="active-brew-summary__stage-marker" data-edge={edge} key={milestone.id} style={{ left: `${position}%` }}><span>{milestone.label}</span></div>
        })}
        <div className="active-brew-summary__stage-card" data-edge={currentStageEdge} style={{ left: `${currentStagePosition}%` }}>
          <strong>{summary.step.name}</strong>
        </div>
      </div>
      <div aria-hidden={confirmingEnd || undefined} className="active-brew-summary__content">
        <header className="active-brew-summary__header">
          <div className="active-brew-summary__utilities">
            <button
              aria-label={sound ? 'Mute brew sounds' : 'Enable brew sounds'}
              aria-pressed={!sound}
              className="active-brew-summary__utility"
              onClick={onToggleSound}
              type="button"
            >
              {sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
            </button>
            <button aria-label={fullscreenActive ? 'Exit full-screen brew summary' : 'Exit brew focus view'} className="active-brew-summary__utility" onClick={exit} ref={exitButtonRef} type="button">
              <Minimize2 aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="active-brew-summary__metrics" id="active-brew-summary-description">
          <section className="active-brew-summary__metric active-brew-summary__metric--timer" aria-label="Elapsed brew time">
            <span>Timer</span>
            <strong>{formatTime(elapsed)}</strong>
            <small>{formatTime(recipe.brewTime)} total</small>
          </section>
          <section className="active-brew-summary__metric active-brew-summary__metric--weight" aria-label="Cumulative water">
            <span>Total water</span>
            <strong>
              {summary.totalWater == null ? '—' : formatWeight(summary.totalWater)}
              {summary.totalWater == null ? null : <em>g</em>}
            </strong>
            <small>{remainingCopy} · {formatRecipeWeight(recipe.water)} g target</small>
          </section>
        </div>
        <span className="active-brew-summary__progress-label" role="status">{summary.progressPercent}% of brew time elapsed</span>

        <footer className="active-brew-summary__footer">
          <div className="active-brew-summary__footer-info">
            <div className="active-brew-summary__stage">
              <span>{complete ? 'Brew complete' : paused ? 'Brew paused' : 'Active brew'}</span>
              <strong id="active-brew-summary-title">{summary.step.name}</strong>
              <small>{recipe.name}</small>
            </div>
            <div className="active-brew-summary__next" aria-live="polite">
              {complete
                ? <><span>Saved brew</span><strong>{message || 'Brew complete'}</strong></>
                : summary.next
                  ? <><span>Next</span><strong>{summary.next.name} at {formatTime(summary.next.start)}</strong></>
                  : <><span>Current</span><strong>{summary.step.instruction}</strong></>}
            </div>
          </div>
          {complete ? null : <div className="active-brew-summary__actions">
            <button className="active-brew-summary__control active-brew-summary__control--primary" onClick={onPauseResume} ref={primaryActionRef} type="button">
              {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              <span>{paused ? 'Resume' : 'Pause'}</span>
            </button>
            <button className="active-brew-summary__control" onClick={requestEnd} ref={endButtonRef} type="button">
              <Square aria-hidden="true" />
              <span>End brew</span>
            </button>
          </div>}
        </footer>
      </div>

      {confirmingEnd ? <div className="active-brew-summary__confirm-backdrop">
        <section aria-labelledby="end-brew-title" aria-modal="true" className="active-brew-summary__confirm" ref={confirmRef} role="alertdialog">
          <span>End active brew</span>
          <h2 id="end-brew-title">Save this brew now?</h2>
          <p>The current timer, weights, and trace will be saved as an early completion.</p>
          <div>
            <button className="active-brew-summary__confirm-cancel" onClick={cancelEnd} ref={cancelEndRef} type="button">Keep brewing</button>
            <button className="active-brew-summary__confirm-end" disabled={ending} onClick={() => void confirmEnd()} type="button">
              {ending ? 'Saving…' : 'End and save'}
            </button>
          </div>
        </section>
      </div> : null}
    </div>,
    document.body,
  )
}
