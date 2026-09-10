import {
  type GenOptions,
  type GenScheme,
  generateScheme,
  type ShellSpec,
} from './genvectors'
import GeneratorWorker from './genvectors.worker?worker'
import type {
  GenerateSchemeRequest,
  GenerateSchemeResponse,
} from './genvectors-worker-protocol'

interface PendingRequest {
  resolve: (scheme: GenScheme) => void
  reject: (error: Error) => void
}

let worker: Worker | null = null
let nextRequestId = 1
const pending = new Map<number, PendingRequest>()
// Set once the worker can't be constructed or fails to load (e.g. a strict CSP
// `worker-src`, a sandboxed iframe). After that we run `generateScheme` on the
// main thread — slower, but the tool keeps working instead of dying with a raw
// error. Modern desktop browsers (which dwi2trx already requires for WebGPU) hit
// this path essentially never.
let workerUnavailable = false

/** Main-thread fallback for environments that block worker construction. */
function generateOnMainThread(
  shells: ShellSpec[],
  options: GenOptions,
): Promise<GenScheme> {
  return Promise.resolve(generateScheme(shells, options))
}

function rejectAll(message: string): void {
  for (const request of pending.values()) request.reject(new Error(message))
  pending.clear()
}

function retireWorker(created: Worker, message: string): void {
  workerUnavailable = true
  rejectAll(message)
  created.terminate()
  if (worker === created) worker = null
}

function getWorker(): Worker {
  if (worker) return worker
  const created = new GeneratorWorker()
  created.onmessage = (event: MessageEvent<GenerateSchemeResponse>) => {
    const response = event.data
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.ok) request.resolve(response.scheme)
    else request.reject(new Error(response.error))
  }
  created.onerror = (event) => {
    // A worker error here is a load/runtime failure of the worker itself (not a
    // per-request generateScheme throw — those come back as {ok:false}). Treat it
    // as permanent and fall back to the main thread on the next call.
    retireWorker(created, event.message || 'Diffusion-vector worker failed.')
  }
  created.onmessageerror = () =>
    retireWorker(
      created,
      'Diffusion-vector worker returned an unreadable message.',
    )
  worker = created
  return created
}

/** Stop obsolete CPU work immediately. A later request creates a fresh worker. */
export function cancelSchemeGeneration(): void {
  if (!worker) return
  const active = worker
  worker = null
  active.terminate()
  rejectAll('Diffusion-vector generation was cancelled.')
}

/** Generate without blocking rendering or input on the browser main thread —
 *  falling back to synchronous main-thread generation if the worker is
 *  unavailable, so the generator degrades gracefully rather than breaking. */
export function generateSchemeInWorker(
  shells: ShellSpec[],
  options: GenOptions = {},
): Promise<GenScheme> {
  // Snapshot inputs synchronously so later form edits can't mutate them, whether
  // we hand them to the worker or run them here.
  const requestShells = shells.map((shell) => ({ ...shell }))
  const requestOptions = { ...options }
  if (workerUnavailable) {
    return generateOnMainThread(requestShells, requestOptions)
  }
  const id = nextRequestId++
  const request: GenerateSchemeRequest = {
    id,
    shells: requestShells,
    options: requestOptions,
  }
  return new Promise((resolve, reject) => {
    let w: Worker
    try {
      w = getWorker()
    } catch {
      // Construction threw (e.g. CSP blocked the worker script) — degrade to the
      // main thread now and for every later call.
      workerUnavailable = true
      resolve(generateOnMainThread(requestShells, requestOptions))
      return
    }
    pending.set(id, { resolve, reject })
    try {
      w.postMessage(request)
    } catch (error) {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
