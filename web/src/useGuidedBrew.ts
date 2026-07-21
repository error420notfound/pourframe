import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildSchedule, createId, normalizeRecipe, validateRecipe } from './brew'
import { captureBaseline, completePairedTelemetry, initialBrewMachine, reduceBrewMachine, relativeReadings, type BrewMachineEvent } from './brewMachine'
import { addSensorSample, newSensorSummary, prepareDevice } from './brewSession'
import type { BrewMode, BrewRecipe, BrewRecord, BrewStatus, StepTransition } from './brewTypes'
import { playCue } from './audio'
import { BrewTraceBuffer, encodeTrace, traceSample } from './trace'
import type { DeviceCommandPayload, DeviceTelemetry, ProtocolAck } from './types'
import type { ConnectionState } from './useDevice'
import { usableScale } from './useDevice'

type LegacySender = (command: 'tare' | 'set_target', channel: 'upper' | 'lower' | 'total', grams?: number) => Promise<ProtocolAck>
type ProtocolSender = (payload: DeviceCommandPayload) => Promise<ProtocolAck>
type SaveBrew = (record: BrewRecord, trace?: Uint8Array) => Promise<void>
type PhysicalCueState = 'ready' | 'active' | 'completed' | 'cancelled' | 'unavailable' | 'health_aborted'
const acknowledgedCommandsKey = 'pourframe.brew.acknowledged.v1'

function loadAcknowledgedCommands() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(acknowledgedCommandsKey) ?? '[]') as unknown
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(-96) : [])
  } catch { return new Set<string>() }
}

export function useGuidedBrew(recipe: BrewRecipe, telemetry: DeviceTelemetry | null, connection: ConnectionState, sendCommand: LegacySender, sendProtocolCommand: ProtocolSender, saveBrew: SaveBrew, sound: boolean) {
  const schedule = useMemo(() => buildSchedule(recipe), [recipe])
  const [machine, setMachine] = useState(initialBrewMachine)
  const machineRef = useRef(machine)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [prepStage, setPrepStage] = useState<'confirm' | 'working' | 'ready' | 'timer' | null>(null)
  const [message, setMessage] = useState('')
  const [physicalCue, setPhysicalCue] = useState<PhysicalCueState>('ready')
  const physicalCueRef = useRef(physicalCue)
  const telemetryRef = useRef(telemetry)
  const clockStartedAt = useRef<number | null>(null)
  const pausedAt = useRef<number | null>(null)
  const pausedTotal = useRef(0)
  const countdownTimers = useRef<number[]>([])
  const pausedStep = useRef<number | null>(null)
  const pendingStep = useRef<{ index: number; transitionId: string; source: 'automatic' | 'manual' } | null>(null)
  const trace = useRef<BrewTraceBuffer | null>(null)
  if (trace.current == null) trace.current = new BrewTraceBuffer()
  const summary = useRef(newSensorSummary('device'))
  const lastTelemetrySequence = useRef<number | null>(null)
  const saved = useRef(false)
  const acknowledgedCommands = useRef<Set<string> | null>(null)
  if (acknowledgedCommands.current == null) acknowledgedCommands.current = loadAcknowledgedCommands()
  telemetryRef.current = telemetry

  const updatePhysicalCue = useCallback((value: PhysicalCueState) => {
    physicalCueRef.current = value
    setPhysicalCue(value)
  }, [])

  const sendOnce = useCallback(async (id: string, payload: DeviceCommandPayload) => {
    const acknowledged = acknowledgedCommands.current ?? loadAcknowledgedCommands()
    acknowledgedCommands.current = acknowledged
    if (acknowledged.has(id)) return { v: 1, type: 'ack', id, ok: true, message: 'Already acknowledged in this browser session' } as ProtocolAck
    const response = await sendProtocolCommand(payload)
    acknowledged.add(id)
    const values = [...acknowledged].slice(-96)
    acknowledgedCommands.current = new Set(values)
    try { sessionStorage.setItem(acknowledgedCommandsKey, JSON.stringify(values)) } catch { /* idempotency remains in memory */ }
    return response
  }, [sendProtocolCommand])

  const event = useCallback((value: BrewMachineEvent) => {
    machineRef.current = reduceBrewMachine(machineRef.current, value)
    setMachine(machineRef.current)
  }, [])

  const clearCountdown = useCallback(() => {
    countdownTimers.current.forEach((timer) => window.clearTimeout(timer))
    countdownTimers.current = []
  }, [])

  const elapsedNow = useCallback(() => {
    if (clockStartedAt.current == null) return 0
    const end = pausedAt.current ?? performance.now()
    return Math.min(Math.max(0, end - clockStartedAt.current - pausedTotal.current), recipe.brewTime * 1000)
  }, [recipe.brewTime])

  const activate = useCallback((index: number, transitionId: string, source: 'automatic' | 'manual') => {
    const step = schedule[index]
    if (!step || step.kind !== 'pour') return
    const actualElapsed = index === 0 ? 0 : Math.round(elapsedNow())
    if (machineRef.current.mode === 'timer_only') {
      const transition: StepTransition = { transition_id: transitionId, step_id: step.id, scheduled_elapsed_ms: Math.round(step.start * 1000), actual_elapsed_ms: actualElapsed, actual_timestamp: new Date().toISOString(), outcome: 'missed', cue: physicalCueRef.current === 'completed' ? 'completed' : 'unavailable', reduced_confidence: true }
      event({ type: 'ACTIVATE_TIMER', stepIndex: index, transition })
      if (index === 0) { clockStartedAt.current = performance.now(); pausedTotal.current = 0; setElapsedMs(0) }
      playCue(index === 0 ? 'start' : 'pour', sound)
      return
    }
    const currentTelemetry = telemetryRef.current
    if (!currentTelemetry) { pendingStep.current = { index, transitionId, source }; event({ type: 'WAIT_FOR_BASELINE' }); setMessage('Live scale data is unavailable.'); return }
    const captured = captureBaseline(currentTelemetry, step, index, actualElapsed, transitionId, source)
    if (!captured) { pendingStep.current = { index, transitionId, source }; event({ type: 'WAIT_FOR_BASELINE' }); setMessage('Live scale data is unavailable or unsynchronized.'); return }
    captured.transition.cue = physicalCueRef.current === 'completed' ? 'completed' : physicalCueRef.current === 'health_aborted' ? 'health_aborted' : 'unavailable'
    event({ type: 'ACTIVATE', ...captured })
    pendingStep.current = null
    setMessage(index === 0 ? 'Brew started.' : `${step.name} started.`)
    if (index === 0) { clockStartedAt.current = performance.now(); pausedTotal.current = 0; setElapsedMs(0) }
    void sendOnce(`step:${transitionId}`, { command: 'brew_step_activate', transition_id: transitionId, baseline_total_grams: captured.baseline.total_g, step_target_grams: step.pour, cumulative_target_grams: step.cumulative }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Physical step target unavailable'))
    playCue(index === 0 ? 'start' : 'pour', sound)
  }, [elapsedNow, event, schedule, sendOnce, sound])

  const beginCountdown = useCallback((index: number, generation = machineRef.current.countdownGeneration) => {
    const step = schedule[index]
    if (!step || step.kind !== 'pour') return
    clearCountdown()
    const cueId = `${machineRef.current.brewId}:${step.id}:${generation}`
    const transitionId = `${machineRef.current.brewId}:${step.id}`
    event({ type: 'COUNTDOWN', cueId, generation })
    updatePhysicalCue(connection === 'online' && machineRef.current.mode === 'device' ? 'active' : 'unavailable')
    if (connection === 'online' && machineRef.current.mode === 'device') {
      void sendOnce(`cue:${cueId}`, { command: 'brew_step_cue', cue_id: cueId, pulse_count: 5, interval_ms: 1000 })
        .catch((error: unknown) => { updatePhysicalCue('unavailable'); setMessage(error instanceof Error ? error.message : 'Physical cue unavailable') })
    }
    for (let pulse = 0; pulse < 5; pulse += 1) countdownTimers.current.push(window.setTimeout(() => playCue('tick', sound), pulse * 1000))
    countdownTimers.current.push(window.setTimeout(() => { if (physicalCueRef.current === 'active') updatePhysicalCue('completed'); activate(index, transitionId, 'automatic') }, 5000))
  }, [activate, clearCountdown, connection, event, schedule, sendOnce, sound, updatePhysicalCue])

  useEffect(() => {
    if (machine.phase === 'IDLE' || machine.phase === 'PREPARING' || machine.phase === 'READY' || machine.phase === 'PAUSED' || machine.phase === 'COMPLETE' || machine.phase === 'ERROR') return
    const timer = window.setInterval(() => setElapsedMs(Math.round(elapsedNow())), 100)
    return () => window.clearInterval(timer)
  }, [elapsedNow, machine.phase])

  useEffect(() => {
    if (machine.phase !== 'POUR_ACTIVE') return
    const nextIndex = machine.currentStepIndex + 1
    const next = schedule[nextIndex]
    if (!next) return
    if (next.kind === 'drawdown') {
      if (elapsedMs >= next.start * 1000) event({ type: 'DRAWDOWN' })
      return
    }
    if (elapsedMs >= Math.max(0, next.start * 1000 - 5000)) beginCountdown(nextIndex)
  }, [beginCountdown, elapsedMs, event, machine.currentStepIndex, machine.phase, schedule])

  useEffect(() => {
    if (machine.mode !== 'device' || machine.phase !== 'POUR_ACTIVE' || !telemetry || !completePairedTelemetry(telemetry)) return
    const current = schedule[machine.currentStepIndex]
    const next = schedule[machine.currentStepIndex + 1]
    const baseline = machine.baselines[machine.baselines.length - 1]
    if (!current || current.kind !== 'pour' || next?.kind !== 'drawdown' || !baseline) return
    const progress = relativeReadings(telemetry, baseline).stepWaterAdded
    if (progress != null && progress >= current.pour) event({ type: 'DRAWDOWN' })
  }, [event, machine.baselines, machine.currentStepIndex, machine.mode, machine.phase, schedule, telemetry])

  useEffect(() => {
    if (machine.phase !== 'WAITING_FOR_STABLE_BASELINE' || !pendingStep.current || !telemetry || !completePairedTelemetry(telemetry)) return
    const pending = pendingStep.current
    activate(pending.index, pending.transitionId, pending.source)
  }, [activate, machine.phase, telemetry])

  useEffect(() => {
    if (machine.mode !== 'device' || clockStartedAt.current == null || machine.phase === 'IDLE' || machine.phase === 'PREPARING' || machine.phase === 'READY' || machine.phase === 'PAUSED' || machine.phase === 'COMPLETE' || !telemetry || telemetry.seq === lastTelemetrySequence.current) return
    lastTelemetrySequence.current = telemetry.seq
    summary.current = addSensorSample(summary.current, telemetry)
    const baseline = machine.baselines[machine.baselines.length - 1]
    if (trace.current!.samples().length < 4200) trace.current!.append(traceSample(telemetry, baseline, Math.round(elapsedNow()), Math.max(0, machine.currentStepIndex)))
  }, [elapsedNow, machine.baselines, machine.currentStepIndex, machine.mode, machine.phase, telemetry])

  useEffect(() => {
    const state = telemetry?.led?.cue_state
    if (state === 'active' || state === 'completed' || state === 'cancelled' || state === 'health_aborted' || state === 'unavailable') updatePhysicalCue(state)
  }, [telemetry?.led?.cue_state, updatePhysicalCue])

  const prepare = useCallback(async () => {
    const validation = validateRecipe(recipe)
    if (!validation.valid) { setMessage(Object.values(validation.errors)[0] ?? 'Recipe is invalid.'); setPrepStage('confirm'); return }
    trace.current!.clear()
    const validationId = createId('brew')
    event({ type: 'PREPARE', brewId: validationId })
    setPrepStage('working'); setMessage('Checking scale health and waiting for tare acknowledgements…')
    const result = await prepareDevice(connection, telemetry, recipe.water, sendCommand)
    setMessage(result.message)
    if (result.kind === 'timer') { event({ type: 'ERROR', message: result.message }); setPrepStage('timer'); return }
    event({ type: 'PREPARED', mode: 'device' }); setPrepStage('ready'); setMessage('PourFrame is ready. Start when you are ready to pour.'); saved.current = false; summary.current = newSensorSummary('device'); lastTelemetrySequence.current = null
  }, [connection, event, recipe, sendCommand, telemetry])

  const startPrepared = useCallback(() => {
    if (machineRef.current.phase !== 'READY') return
    const currentTelemetry = telemetryRef.current
    if (!currentTelemetry || !completePairedTelemetry(currentTelemetry)) {
      setMessage('Live scale data is unavailable or unsynchronized. You can start in timer-only mode instead.')
      setPrepStage('timer')
      return
    }
    setPrepStage(null)
    const step = schedule[0]
    if (!step || step.kind !== 'pour') return
    activate(0, `${machineRef.current.brewId}:${step.id}`, 'automatic')
  }, [activate, schedule])

  const startTimerOnly = useCallback(() => {
    const brewId = machineRef.current.brewId || createId('brew')
    if (machineRef.current.phase !== 'PREPARING' && machineRef.current.phase !== 'ERROR') event({ type: 'PREPARE', brewId })
    if (machineRef.current.phase === 'ERROR') { machineRef.current = { ...initialBrewMachine(), phase: 'PREPARING', brewId }; setMachine(machineRef.current) }
    event({ type: 'PREPARED', mode: 'timer_only' }); setPrepStage(null); setMessage('Timer-only brew started. Scale readings will not be recorded.'); saved.current = false; trace.current!.clear(); summary.current = newSensorSummary('timer_only')
    const step = schedule[0]
    if (step?.kind === 'pour') activate(0, `${machineRef.current.brewId}:${step.id}`, 'automatic')
  }, [activate, event, schedule])

  const continueTimerOnly = useCallback(() => {
    const pending = pendingStep.current
    if (machineRef.current.phase !== 'WAITING_FOR_STABLE_BASELINE' || !pending) return
    machineRef.current = { ...machineRef.current, mode: 'timer_only', reducedConfidence: true }
    setMachine(machineRef.current)
    summary.current = { ...summary.current, mode: 'timer_only' }
    setMessage('Continuing timer-only. This transition is recorded as missed with reduced confidence.')
    activate(pending.index, pending.transitionId, pending.source)
    pendingStep.current = null
  }, [activate])

  const pauseResume = useCallback(() => {
    if (machineRef.current.phase === 'PAUSED') {
      if (pausedAt.current != null) pausedTotal.current += performance.now() - pausedAt.current
      pausedAt.current = null
      const restart = pausedStep.current
      event({ type: 'RESUME' })
      if (restart != null) { pausedStep.current = null; beginCountdown(restart, machineRef.current.countdownGeneration) }
      return
    }
    if (machineRef.current.phase === 'STEP_COUNTDOWN' || machineRef.current.phase === 'WAITING_FOR_STABLE_BASELINE') {
      pausedStep.current = pendingStep.current?.index ?? Math.max(0, machineRef.current.currentStepIndex + 1)
      const cueId = machineRef.current.activeCueId
      if (cueId) void sendOnce(`cancel:${cueId}`, { command: 'brew_step_cue_cancel', cue_id: cueId }).catch(() => undefined)
      updatePhysicalCue('cancelled')
    }
    clearCountdown(); pausedAt.current = performance.now(); event({ type: 'PAUSE' })
  }, [beginCountdown, clearCountdown, event, sendOnce, updatePhysicalCue])

  const reset = useCallback(() => {
    const cueId = machineRef.current.activeCueId
    if (cueId) void sendOnce(`cancel:${cueId}`, { command: 'brew_step_cue_cancel', cue_id: cueId }).catch(() => undefined)
    void sendProtocolCommand({ command: 'brew_step_clear' }).catch(() => undefined)
    clearCountdown(); clockStartedAt.current = null; pausedAt.current = null; pausedTotal.current = 0; pendingStep.current = null; trace.current!.clear(); summary.current = newSensorSummary('device'); setElapsedMs(0); setPrepStage(null); setMessage(''); updatePhysicalCue('ready'); event({ type: 'RESET' })
  }, [clearCountdown, event, sendOnce, sendProtocolCommand, updatePhysicalCue])

  const finish = useCallback(async () => {
    if (saved.current) return
    saved.current = true; clearCountdown(); event({ type: 'COMPLETE' }); playCue('complete', sound)
    void sendProtocolCommand({ command: 'brew_step_clear' }).catch(() => undefined)
    const encoded = machineRef.current.mode === 'device' ? encodeTrace(trace.current!.samples()) : null
    const recordDeviceData = machineRef.current.mode === 'device'
    const finalLower = recordDeviceData && usableScale(telemetry?.scales.lower) ? telemetry!.scales.lower.grams : null
    const record: BrewRecord = { id: machineRef.current.brewId, completed_at: new Date().toISOString(), elapsed_s: elapsedNow() / 1000, recipe: normalizeRecipe(recipe), schedule, baselines: machineRef.current.baselines, transitions: machineRef.current.transitions, final: { upper_g: recordDeviceData && usableScale(telemetry?.scales.upper) ? telemetry!.scales.upper.grams : null, lower_g: finalLower, total_g: recordDeviceData && telemetry?.total.available && !telemetry.total.partial && Number.isFinite(telemetry.total.grams) ? telemetry.total.grams : null, beverage_g: finalLower }, sensor_summary: summary.current, trace: encoded?.metadata ?? null }
    try { await saveBrew(record, encoded?.bytes); setMessage('Brew saved on PourFrame.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Brew saved to the local retry outbox') }
  }, [clearCountdown, elapsedNow, event, recipe, saveBrew, schedule, sendProtocolCommand, sound, telemetry])

  useEffect(() => { if (machine.phase === 'DRAWDOWN' && elapsedMs >= recipe.brewTime * 1000) void finish() }, [elapsedMs, finish, machine.phase, recipe.brewTime])
  useEffect(() => () => clearCountdown(), [clearCountdown])

  const manualAdvance = useCallback(() => {
    const index = machineRef.current.phase === 'WAITING_FOR_STABLE_BASELINE' && pendingStep.current ? pendingStep.current.index : machineRef.current.currentStepIndex + 1
    const step = schedule[index]
    if (!step || step.kind !== 'pour') return
    const transitionId = `${machineRef.current.brewId}:${step.id}`
    pendingStep.current = { index, transitionId, source: 'manual' }
    if (telemetry && completePairedTelemetry(telemetry)) activate(index, transitionId, 'manual')
    else setMessage('Manual advance armed. Waiting for a synchronized paired reading, or switch to timer-only mode.')
  }, [activate, schedule, telemetry])

  const status: BrewStatus = machine.phase === 'IDLE' || machine.phase === 'ERROR' ? 'idle' : machine.phase === 'PREPARING' || machine.phase === 'READY' ? 'preparing' : machine.phase === 'PAUSED' ? 'paused' : machine.phase === 'COMPLETE' ? 'complete' : 'brewing'
  const baseline = machine.baselines[machine.baselines.length - 1]
  return { machine, status, elapsed: elapsedMs / 1000, schedule, traceBuffer: trace.current, prepStage, setPrepStage, message, physicalCue, relative: relativeReadings(telemetry, baseline), prepare, startPrepared, startTimerOnly, continueTimerOnly, pauseResume, reset, finish, manualAdvance }
}
