import assert from 'node:assert/strict'
import {
  assertInputSize,
  formatBytes,
  InputTooLargeError,
  MAX_INPUT_BYTES,
} from './input-limits.ts'

const sizedFile = (size: number): File => ({ size }) as File

assert.doesNotThrow(() => assertInputSize([sizedFile(MAX_INPUT_BYTES)]))
assert.throws(
  () => assertInputSize([sizedFile(1_500_000_000), sizedFile(500_000_001)]),
  (error) =>
    error instanceof InputTooLargeError &&
    error.actualBytes === 2_000_000_001 &&
    error.limitBytes === MAX_INPUT_BYTES,
)
assert.equal(formatBytes(30_000_000_000), '30.0 GB')
assert.equal(formatBytes(MAX_INPUT_BYTES), '2.00 GB')

console.log('input.test.ts: size guard and formatting OK')
