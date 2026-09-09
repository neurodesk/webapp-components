import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSession, browserRuntime, GPU_IMPLEMENTATION } from '../src/browser.js';
import manifest from '../model.manifest.json' with { type: 'json' };
import graph from '../src/gpu-model.json' with { type: 'json' };

test('browser defaults to WASM with the supplied runtime and model', async () => {
  const bytes = new Uint8Array([1, 2]), session = {};
  const ort = { InferenceSession: { create(model, options) {
    assert.equal(model, bytes);
    assert.deepEqual(options, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return session;
  } } };
  assert.equal(await createBrowserSession(ort, bytes, undefined, [32, 32, 32]), session);
  assert.throws(() => createBrowserSession(ort, bytes, 'cuda'), /wasm or webgpu/);
});

test('WebGPU routes to the pinned custom executor and never falls back to ORT', async () => {
  const ort = { InferenceSession: { create() { assert.fail('GPU must not use ORT'); } } };
  await assert.rejects(createBrowserSession(ort, new Uint8Array(16), 'webgpu', [32, 32, 32]), /validated SynthSR model/);
  assert.deepEqual(browserRuntime('webgpu'), { gpuImplementation: GPU_IMPLEMENTATION });
  assert.deepEqual(browserRuntime(), { onnxRuntime: '1.29.0' });
  const asset = manifest.assets.find(a => a.filename === 'synthsr-v2.onnx');
  assert.equal(graph.sha256, asset.sha256);
  assert.equal(graph.bytes, asset.bytes);
});
