import { runSynthsr } from '@neurodesk/synthsr';
import { createGpuSession, GPU_IMPLEMENTATION } from './gpu-session.js';
import * as ort from 'onnxruntime-web/webgpu';
import wasmURL from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import wasmModuleURL from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

ort.env.wasm.wasmPaths = { wasm: wasmURL, mjs: wasmModuleURL };
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
const progress = (value, message) => self.postMessage({ type: 'progress', value, message });
const sha256 = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('');

async function modelBytes(model) {
  if (model.file) {
    if(model.file.size!==model.bytes) throw new Error('Choose the validated synthsr-v2.onnx file. This file has a different size.');
    const bytes = await model.file.arrayBuffer();
    const hash = await sha256(bytes);
    if (model.sha256 && hash !== model.sha256) throw new Error('This model does not match the validated SynthSR weights. Choose the exported synthsr-v2.onnx file.');
    return { bytes, hash };
  }
  let cache;
  try { cache = await caches.open('neurodesk-synthsr-v1'); } catch { /* caching is optional */ }
  let response = await cache?.match(model.url);
  if (!response) {
    response = await fetch(model.url);
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('Could not download SynthSR weights. Check the connection, or select a local synthsr-v2.onnx file in Model settings.');
    // Cache only after verifying all bytes, below.
  }
  const length = Number(response.headers.get('content-length')) || model.bytes;
  const reader = response.body.getReader(), chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.length;
    if(received>model.bytes) throw new Error('The downloaded model exceeds its expected size and was rejected.');
    progress(0.12 + 0.13 * Math.min(1, received / (length || received)), `Loading model · ${(received/1048576).toFixed(1)} MB`);
  }
  const bytes = new Uint8Array(received);
  let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const hash = await sha256(bytes);
  if (model.sha256 && hash !== model.sha256) { await cache?.delete(model.url); throw new Error('Model checksum mismatch. The downloaded file was rejected.'); }
  try { await cache?.put(model.url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* quota/private mode */ }
  return { bytes, hash };
}

async function createSession(bytes, backend, shape) {
  if (backend === 'webgpu') return createGpuSession(bytes, shape);
  return ort.InferenceSession.create(bytes, {
    executionProviders: [backend], graphOptimizationLevel: 'all',
  });
}

self.onmessage = async ({ data: job }) => {
  try {
    const {buffer,provenance}=await runSynthsr({
      buffer:await job.file.arrayBuffer(),options:job.options,Tensor:ort.Tensor,
      loadModel:()=>modelBytes(job.model),createSession,onProgress:progress,
      runtime:{app:'SynthSR web 0.1.1',...(job.options.backend==='webgpu'
        ? {gpuImplementation:GPU_IMPLEMENTATION}
        : {onnxRuntime:'1.29.0'})},
    });
    self.postMessage({type:'result',buffer,provenance},[buffer]);
  } catch(error) { self.postMessage({type:'error',message:error.message || String(error)}); }
};
