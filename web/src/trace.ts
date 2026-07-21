import type { StepBaseline, TraceMetadata } from './brewTypes'
import type { DeviceTelemetry } from './types'
import { relativeReadings, stablePairedTelemetry } from './brewMachine'
import { usableScale } from './useDevice'

const magic = 0x52544650
const headerBytes = 16
// Fixed-point packing keeps five seven-minute traces plus an in-flight upload
// comfortably inside the existing 1.5 MB LittleFS partition.
const recordBytes = 33
const missing32 = -0x80000000
const missing16 = -0x8000

const packGrams = (value: number) => Number.isFinite(value) ? Math.max(-0x7fffffff, Math.min(0x7fffffff, Math.round(value * 100))) : missing32
const unpackGrams = (value: number) => value === missing32 ? Number.NaN : value / 100
const packRate = (value: number) => Number.isFinite(value) ? Math.max(-0x7fff, Math.min(0x7fff, Math.round(value * 100))) : missing16
const unpackRate = (value: number) => value === missing16 ? Number.NaN : value / 100

export interface BrewTraceSample {
  elapsedMs: number
  upper: number
  lower: number
  total: number
  relativeUpper: number
  relativeLower: number
  stepWaterAdded: number
  pourRate: number
  confidence: number
  flags: number
  stepIndex: number
}

export function traceSample(telemetry: DeviceTelemetry, baseline: StepBaseline | undefined, elapsedMs: number, stepIndex: number): BrewTraceSample {
  const relative = relativeReadings(telemetry, baseline)
  let flags = 0
  if (usableScale(telemetry.scales.upper)) flags |= 1
  if (usableScale(telemetry.scales.lower)) flags |= 2
  if (telemetry.total.partial) flags |= 4
  if (telemetry.measurement.pair_valid) flags |= 8
  if (telemetry.measurement.is_stable) flags |= 16
  if (stablePairedTelemetry(telemetry)) flags |= 32
  return { elapsedMs, upper: telemetry.scales.upper.grams, lower: telemetry.scales.lower.grams, total: telemetry.total.grams ?? Number.NaN, relativeUpper: relative.relativeUpper ?? Number.NaN, relativeLower: relative.relativeLower ?? Number.NaN, stepWaterAdded: relative.stepWaterAdded ?? Number.NaN, pourRate: telemetry.total.pour_rate_g_s, confidence: telemetry.measurement.confidence, flags, stepIndex }
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function encodeTrace(samples: BrewTraceSample[]): { bytes: Uint8Array; metadata: TraceMetadata } {
  const bytes = new Uint8Array(headerBytes + samples.length * recordBytes)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, magic, true); view.setUint16(4, 1, true); view.setUint16(6, recordBytes, true); view.setUint32(8, samples.length, true)
  samples.forEach((sample, index) => {
    let offset = headerBytes + index * recordBytes
    view.setUint32(offset, Math.max(0, Math.round(sample.elapsedMs)), true); offset += 4
    for (const value of [sample.upper, sample.lower, sample.total, sample.relativeUpper, sample.relativeLower, sample.stepWaterAdded]) { view.setInt32(offset, packGrams(value), true); offset += 4 }
    view.setInt16(offset, packRate(sample.pourRate), true); offset += 2
    view.setUint8(offset, Number.isFinite(sample.confidence) ? Math.round(Math.max(0, Math.min(1, sample.confidence)) * 254) : 255); offset += 1
    view.setUint8(offset, sample.flags & 0xff); offset += 1
    view.setUint8(offset, Math.max(0, Math.min(255, sample.stepIndex)))
  })
  const checksum = crc32(bytes.subarray(headerBytes))
  view.setUint32(12, checksum, true)
  return { bytes, metadata: { schema: 1, sample_hz: 10, sample_count: samples.length, byte_length: bytes.byteLength, crc32: checksum.toString(16).padStart(8, '0'), available: true } }
}

export function decodeTrace(bytes: Uint8Array): BrewTraceSample[] {
  if (bytes.byteLength < headerBytes) throw new Error('Trace is too short')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== magic || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== recordBytes) throw new Error('Unsupported trace format')
  const count = view.getUint32(8, true)
  if (bytes.byteLength !== headerBytes + count * recordBytes || view.getUint32(12, true) !== crc32(bytes.subarray(headerBytes))) throw new Error('Trace checksum mismatch')
  const samples: BrewTraceSample[] = []
  for (let index = 0; index < count; index += 1) {
    let offset = headerBytes + index * recordBytes
    const elapsedMs = view.getUint32(offset, true); offset += 4
    const values: number[] = []
    for (let field = 0; field < 6; field += 1) { values.push(unpackGrams(view.getInt32(offset, true))); offset += 4 }
    const pourRate = unpackRate(view.getInt16(offset, true)); offset += 2
    const packedConfidence = view.getUint8(offset); offset += 1
    const flags = view.getUint8(offset); offset += 1
    samples.push({ elapsedMs, upper: values[0], lower: values[1], total: values[2], relativeUpper: values[3], relativeLower: values[4], stepWaterAdded: values[5], pourRate, confidence: packedConfidence === 255 ? Number.NaN : packedConfidence / 254, flags, stepIndex: view.getUint8(offset) })
  }
  return samples
}
