import completeSound from './assets/audio/complete.wav'
import errorSound from './assets/audio/error.wav'
import startSound from './assets/audio/start.wav'
import tickSound from './assets/audio/tick.wav'

export type AudioCue = 'start' | 'pour' | 'complete' | 'tick' | 'error'

const cueUrls: Record<AudioCue, string> = {
  start: startSound,
  pour: startSound,
  complete: completeSound,
  tick: tickSound,
  error: errorSound,
}

let audioContext: AudioContext | null = null
let masterGain: GainNode | null = null
let audioEnabled = true
const cueBuffers = new Map<AudioCue, Promise<AudioBuffer>>()

function ensureAudioGraph() {
  const AudioConstructor = window.AudioContext || window.webkitAudioContext
  if (!AudioConstructor) return null
  audioContext ??= new AudioConstructor()
  if (!masterGain) {
    masterGain = audioContext.createGain()
    masterGain.gain.value = audioEnabled ? 1 : 0
    masterGain.connect(audioContext.destination)
  }
  return { context: audioContext, output: masterGain }
}

function loadCue(context: AudioContext, cue: AudioCue) {
  let buffer = cueBuffers.get(cue)
  if (!buffer) {
    buffer = fetch(cueUrls[cue])
      .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`Unable to load ${cue} sound`)))
      .then((bytes) => context.decodeAudioData(bytes))
    cueBuffers.set(cue, buffer)
  }
  return buffer
}

export function setAudioEnabled(enabled: boolean) {
  audioEnabled = enabled
  if (!audioContext || !masterGain) return
  const now = audioContext.currentTime
  masterGain.gain.cancelScheduledValues(now)
  masterGain.gain.setValueAtTime(enabled ? 1 : 0, now)
  if (enabled && audioContext.state === 'suspended') void audioContext.resume()
}

export function playCue(cue: AudioCue) {
  if (!audioEnabled) return
  try {
    const graph = ensureAudioGraph()
    if (!graph) return
    const { context, output } = graph
    if (context.state === 'suspended') void context.resume()
    void loadCue(context, cue).then((buffer) => {
      if (!audioEnabled) return
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(output)
      source.start()
    }).catch(() => { /* Audio is progressive enhancement. */ })
  } catch { /* Audio is progressive enhancement. */ }
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }
