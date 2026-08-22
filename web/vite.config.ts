import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { validateRemoteAssetBaseUrl } from './scripts/remote-asset-config.mjs'

export default defineConfig(({ mode }) => {
  validateRemoteAssetBaseUrl(loadEnv(mode, '.', '').VITE_REMOTE_ASSET_BASE_URL, { mode })
  return {
    base: './',
    plugins: [react()],
    build: {
      outDir: '../data',
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2020',
    },
  }
})
