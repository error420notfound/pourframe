import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerPourFrameServiceWorker } from './pwa'
import { warmFunctionalAudio } from './audio'
import { beginStartup, cacheDebug, markShellReady, startOptionalWarming } from './startup'
import './styles.css'

beginStartup()
registerPourFrameServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

requestAnimationFrame(() => {
  markShellReady()
  const schedule = window.requestIdleCallback ?? ((callback: IdleRequestCallback) => window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 0))
  schedule(() => { void warmFunctionalAudio().then((bytes) => cacheDebug('asset-warm:audio', { bytes })); void startOptionalWarming() }, { timeout: 2_000 })
})
