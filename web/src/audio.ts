export type AudioCue = 'start' | 'pour' | 'complete' | 'tick'
let audioContext: AudioContext | null = null

export function playCue(cue: AudioCue, enabled: boolean) {
  if (!enabled) return
  try {
    const AudioConstructor = window.AudioContext || window.webkitAudioContext
    if (!AudioConstructor) return
    audioContext ??= new AudioConstructor()
    if (audioContext.state === 'suspended') void audioContext.resume()
    const frequencies = cue === 'complete' ? [523.25, 659.25, 783.99] : cue === 'pour' ? [880, 1174.66] : cue === 'tick' ? [1046.5] : [440, 659.25]
    frequencies.forEach((frequency, index) => {
      const oscillator = audioContext!.createOscillator()
      const gain = audioContext!.createGain()
      const start = audioContext!.currentTime + index * 0.045
      oscillator.type = cue === 'complete' ? 'triangle' : 'sine'
      oscillator.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(cue === 'tick' ? 0.04 : 0.07, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, start + (cue === 'tick' ? 0.16 : 0.65))
      oscillator.connect(gain); gain.connect(audioContext!.destination)
      oscillator.start(start); oscillator.stop(start + 0.7)
    })
  } catch { /* Audio is progressive enhancement. */ }
}

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }
