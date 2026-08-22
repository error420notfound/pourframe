import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerPourFrameServiceWorker } from './pwa'
import { installRemoteFonts } from './remoteAssets'
import './styles.css'

installRemoteFonts()
registerPourFrameServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

const splash = document.getElementById('app-splash')
if (splash) {
  requestAnimationFrame(() => {
    splash.classList.add('app-splash--hidden')
    window.setTimeout(() => splash.remove(), 220)
  })
}
