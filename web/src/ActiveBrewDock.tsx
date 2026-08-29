import { useEffect, useRef, useState } from 'react'
import { ArrowsPointingOutIcon as Maximize, ChevronDownIcon as ChevronDown, ChevronUpIcon as ChevronUp, PauseIcon as Pause, PlayIcon as Play, StopIcon as Stop } from '@heroicons/react/24/solid'
import { deriveCompactBrewStatus } from './compactBrewStatus'
import { formatRecipeWeight, formatTime } from './brew'
import type { BrewRecipe, BrewStatus, BrewStep } from './brewTypes'
import { EndBrewConfirmation } from './EndBrewConfirmation'

function displayWeight(value: number | null) {
  return value == null ? '—' : `${formatRecipeWeight(value)} g`
}

export function ActiveBrewDock({ dark, elapsed, onEnd, onOpenFocus, onPauseResume, recipe, status, step, totalWeight }: {
  dark: boolean
  elapsed: number
  onEnd: () => Promise<void>
  onOpenFocus: () => void
  onPauseResume: () => void
  recipe: BrewRecipe | null
  status: BrewStatus
  step: BrewStep | null
  totalWeight: number | null
}) {
  const collapsedRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLButtonElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const compact = deriveCompactBrewStatus({ recipe, step, elapsed, currentWeight: totalWeight })
  const paused = status === 'paused'

  useEffect(() => {
    const element = collapsedRef.current
    if (!element) return
    const check = () => {
      const overflow = element.scrollWidth > element.clientWidth + 1
      setOverflows(overflow)
      if (!overflow && window.matchMedia('(min-width: 641px)').matches) setExpanded(false)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (confirmingEnd) { setConfirmingEnd(false); requestAnimationFrame(() => endRef.current?.focus()) }
      else if (expanded) setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmingEnd, expanded])

  const confirmEnd = async () => {
    if (ending) return
    setEnding(true)
    try { await onEnd(); setConfirmingEnd(false) } finally { setEnding(false) }
  }
  const canExpand = true

  return <aside aria-label="Current brew status" className={expanded ? 'active-brew-dock active-brew-dock--expanded' : 'active-brew-dock'} data-overflows={overflows} data-theme={dark ? 'dark' : 'light'}>
    <div className="active-brew-dock__collapsed" ref={collapsedRef}>
      <div className="active-brew-dock__identity"><small>{paused ? 'Brew paused' : compact.stageName}</small><strong>{compact.recipeName}</strong></div>
      <dl className="active-brew-dock__metrics">
        <div><dt>Time</dt><dd>{formatTime(compact.elapsed)}{compact.targetTime != null ? <small> / {formatTime(compact.targetTime)}</small> : null}</dd></div>
        <div><dt>Weight</dt><dd aria-label={compact.currentWeight == null ? 'Weight unavailable' : undefined}>{displayWeight(compact.currentWeight)}{compact.targetWeight != null ? <small> / {formatRecipeWeight(compact.targetWeight)} g</small> : null}</dd></div>
      </dl>
      <div className="active-brew-dock__actions">
        <button aria-label={paused ? 'Resume brew' : 'Pause brew'} className="active-brew-dock__action active-brew-dock__action--primary" onClick={onPauseResume} type="button">{paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}</button>
        <button aria-label="End and save brew" className="active-brew-dock__action" onClick={() => setConfirmingEnd(true)} ref={endRef} type="button"><Stop aria-hidden="true" /></button>
        <button aria-label="Open full-screen brew view" className="active-brew-dock__action" onClick={onOpenFocus} type="button"><Maximize aria-hidden="true" /></button>
        {canExpand ? <button aria-expanded={expanded} aria-label={expanded ? 'Collapse brew status' : 'Expand brew status'} className="active-brew-dock__action active-brew-dock__toggle" onClick={() => setExpanded((value) => !value)} type="button">{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}</button> : null}
      </div>
    </div>
    {expanded ? <div className="active-brew-dock__details"><div><span>Recipe</span><strong>{compact.recipeName}</strong></div><div><span>Current stage</span><strong>{compact.stageName}</strong></div><div><span>Elapsed time</span><strong>{formatTime(compact.elapsed)}{compact.targetTime != null ? ` of ${formatTime(compact.targetTime)}` : ''}</strong></div><div><span>Current weight</span><strong>{displayWeight(compact.currentWeight)}{compact.targetWeight != null ? ` of ${formatRecipeWeight(compact.targetWeight)} g` : ''}</strong></div></div> : null}
    {confirmingEnd ? <EndBrewConfirmation dark={dark} ending={ending} onCancel={() => { setConfirmingEnd(false); requestAnimationFrame(() => endRef.current?.focus()) }} onConfirm={() => void confirmEnd()} /> : null}
  </aside>
}
