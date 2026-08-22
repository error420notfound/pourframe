/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CATALOG_BASE_URL?: string
  readonly VITE_REMOTE_ASSET_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
