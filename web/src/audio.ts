export type AudioCue = 'start' | 'pour' | 'complete' | 'tick'
let audioContext: AudioContext | null = null
let masterGain: GainNode | null = null
let audioEnabled = true

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
    const frequencies = cue === 'complete' ? [523.25, 659.25, 783.99] : cue === 'pour' ? [880, 1174.66] : cue === 'tick' ? [1046.5] : [440, 659.25]
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime + index * 0.045
      oscillator.type = cue === 'complete' ? 'triangle' : 'sine'
      oscillator.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(cue === 'tick' ? 0.04 : 0.07, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, start + (cue === 'tick' ? 0.16 : 0.65))
      oscillator.connect(gain); gain.connect(output)
      oscillator.start(start); oscillator.stop(start + 0.7)
    })
  } catch { /* Audio is progressive enhancement. */ }
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }
