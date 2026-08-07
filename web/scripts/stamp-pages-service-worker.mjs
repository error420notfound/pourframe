import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { stampServiceWorker } from './precompress.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const outputDirectory = path.resolve(scriptDirectory, '../dist')
const version = await stampServiceWorker(outputDirectory)

if (version) console.log(`Stamped Pages service worker cache: ${version}`)
