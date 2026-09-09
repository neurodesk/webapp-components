import { createStreamedWasmSession, needsStreamedWasm, WASM_IMPLEMENTATION } from './wasm-session.js';
import { createGpuSession, GPU_IMPLEMENTATION } from './gpu-session.js';

export { createGpuSession, planGpuGraph, GPU_IMPLEMENTATION } from './gpu-session.js';

// Apps supply their bundled ORT instance (and its WASM asset URLs). The shared
// pipeline supplies the prepared, padded shape, including its tiling policy.
export function createBrowserSession(ort, bytes, backend = 'wasm', shape) {
  if (backend === 'webgpu') return createGpuSession(bytes, shape);
  if (backend !== 'wasm') throw new Error('SynthSR browser backend must be wasm or webgpu.');
  if (shape && needsStreamedWasm(shape)) return createStreamedWasmSession(bytes, shape, ort);
  return ort.InferenceSession.create(bytes, {
    executionProviders: ['wasm'], graphOptimizationLevel: 'all',
  });
}

export function browserRuntime(backend = 'wasm', shape) {
  return backend === 'webgpu'
    ? { gpuImplementation: GPU_IMPLEMENTATION }
    : { onnxRuntime: '1.29.0', ...(shape ? {wasmImplementation:needsStreamedWasm(shape)?WASM_IMPLEMENTATION:'onnxruntime-full-volume'} : {}) };
}
