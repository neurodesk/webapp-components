import { createGpuSession } from '@neurodesk/runtime-support/gpu-unet';
import graph from './gpu-model.json' with { type: 'json' };

export const GPU_IMPLEMENTATION = 'synthseg-blocked-fp32-v1';

// WebGPU only: SynthSeg's 33-class output is far too large for the ORT wasm backend.
export function createBrowserSession(bytes, dims) {
  return createGpuSession(bytes, dims, { graph, outputChannels: 33, label: 'SynthSeg' });
}

export function browserRuntime() {
  return { gpuImplementation: GPU_IMPLEMENTATION };
}
