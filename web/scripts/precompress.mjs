import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { validateRemoteAssetBaseUrl } from './remote-asset-config.mjs'

const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest'])
const CACHE_VERSION_TOKEN = '__POURFRAME_CACHE_VERSION__'
const REMOTE_ASSET_BASE_TOKEN = '__POURFRAME_REMOTE_ASSET_BASE_URL__'
const SHELL_URLS_TOKEN = '__POURFRAME_SHELL_URLS__'

export function shouldCompress(filePath) {
  return !filePath.toLowerCase().endsWith('.gz') && COMPRESSIBLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export function gzipDeterministic(contents) {
  return gzipSync(contents, { level: 9, mtime: 0 })
}

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesRecursively(entryPath))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files
}

export async function stampServiceWorker(directory, configuredRemoteAssetBaseUrl = process.env.VITE_REMOTE_ASSET_BASE_URL ?? '') {
  const root = path.resolve(directory)
  const serviceWorkerPath = path.join(root, 'sw.js')
  let source
  try {
    source = await readFile(serviceWorkerPath, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
  if (!source.includes(CACHE_VERSION_TOKEN)) throw new Error(`sw.js is missing ${CACHE_VERSION_TOKEN}`)
  if (!source.includes(REMOTE_ASSET_BASE_TOKEN)) throw new Error(`sw.js is missing ${REMOTE_ASSET_BASE_TOKEN}`)
  if (!source.includes(SHELL_URLS_TOKEN)) throw new Error(`sw.js is missing ${SHELL_URLS_TOKEN}`)

  const remoteAssetBaseUrl = validateRemoteAssetBaseUrl(configuredRemoteAssetBaseUrl)

  const hash = createHash('sha256')
  const files = await filesRecursively(root)
  const shellUrls = ['./', ...files
    .filter((file) => file !== serviceWorkerPath)
    .map((file) => `./${path.relative(root, file).split(path.sep).join('/')}`)]
  hash.update(remoteAssetBaseUrl)
  hash.update('\0')
  for (const file of files) {
    if (file === serviceWorkerPath) continue
    hash.update(path.relative(root, file).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }
  const version = hash.digest('hex').slice(0, 16)
  await writeFile(serviceWorkerPath, source
    .replaceAll(CACHE_VERSION_TOKEN, version)
    .replaceAll(REMOTE_ASSET_BASE_TOKEN, JSON.stringify(remoteAssetBaseUrl))
    .replaceAll(SHELL_URLS_TOKEN, JSON.stringify(shellUrls)))
  return version
}

export async function precompressDirectory(directory) {
  const root = path.resolve(directory)
  await stampServiceWorker(root)
  const sourceFiles = await filesRecursively(root)
  const assets = []

  for (const sourcePath of sourceFiles) {
    const rawBytes = (await stat(sourcePath)).size
    const relativePath = path.relative(root, sourcePath).split(path.sep).join('/')
    if (!shouldCompress(sourcePath)) {
      assets.push({ path: relativePath, rawBytes, gzipBytes: null, storedBytes: rawBytes })
      continue
    }

    const compressed = gzipDeterministic(await readFile(sourcePath))
    const gzipPath = `${sourcePath}.gz`
    const temporaryPath = `${gzipPath}.tmp`
    await writeFile(temporaryPath, compressed)
    await rename(temporaryPath, gzipPath)
    await rm(sourcePath)
    assets.push({ path: `${relativePath}.gz`, rawBytes, gzipBytes: compressed.length, storedBytes: compressed.length })
  }

  return assets
}

export function summarizeAssets(assets) {
  return assets.reduce((summary, asset) => ({
    rawBytes: summary.rawBytes + asset.rawBytes,
    storedBytes: summary.storedBytes + asset.storedBytes,
  }), { rawBytes: 0, storedBytes: 0 })
}

function printReport(assets) {
  for (const asset of assets) {
    const gzip = asset.gzipBytes === null ? '-' : asset.gzipBytes
    console.log(`${asset.path}\traw=${asset.rawBytes}\tgzip=${gzip}\tstored=${asset.storedBytes}`)
  }
  const totals = summarizeAssets(assets)
  const saved = totals.rawBytes - totals.storedBytes
  const percent = totals.rawBytes === 0 ? '0.00' : (saved / totals.rawBytes * 100).toFixed(2)
  console.log(`TOTAL\traw=${totals.rawBytes}\tstored=${totals.storedBytes}\tsaved=${saved}\tpercent=${percent}%`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const outputDirectory = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data')
  const assets = await precompressDirectory(outputDirectory)
  printReport(assets)
}
