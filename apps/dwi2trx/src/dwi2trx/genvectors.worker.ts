import { generateScheme } from './genvectors'
import type {
  GenerateSchemeRequest,
  GenerateSchemeResponse,
} from './genvectors-worker-protocol'

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<GenerateSchemeRequest>) => void) | null
  postMessage: (message: GenerateSchemeResponse) => void
}

worker.onmessage = (event) => {
  const { id, shells, options } = event.data
  try {
    worker.postMessage({
      id,
      ok: true,
      scheme: generateScheme(shells, options),
    })
  } catch (error) {
    worker.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
