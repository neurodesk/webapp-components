export const MAX_INPUT_BYTES = 2_000_000_000 // 2 GB total across the input

export class InputTooLargeError extends Error {
  readonly actualBytes: number
  readonly limitBytes: number

  constructor(actualBytes: number, limitBytes = MAX_INPUT_BYTES) {
    super(
      `Input too large (${formatBytes(actualBytes)}; browser limit ${formatBytes(limitBytes)}).`,
    )
    this.name = 'InputTooLargeError'
    this.actualBytes = actualBytes
    this.limitBytes = limitBytes
  }
}

export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unit]}`
}

/** Enforce the browser/WASM address-space ceiling on every input path. */
export function assertInputSize(files: File[]): void {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_INPUT_BYTES) throw new InputTooLargeError(totalBytes)
}
