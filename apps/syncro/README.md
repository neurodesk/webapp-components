# SYNcro webapp

Local browser normalization: SynthSR → SynthStrip → ANTs SyN → resampling of acquired images into MNI space. Uses NiiVue 1.0.0-rc.11, the shared imaging workspace and optimized WebGPU synthesis by default.

From the repository root:

```bash
pnpm --filter syncro build
pnpm --filter syncro preview --host 127.0.0.1 --port 5175
```

Open `/syncro/`. Use a desktop browser with cross-origin isolation and several GB of available memory. The bundled service worker supplies isolation on compatible static hosts. No input images are sent to a processing service. Hugging Face supplies pinned models, and the optional real example comes from OpenNeuro.

The build emits registration assets, template licensing information and `downloads/neurodesk-syncro-0.1.0.tgz`. Standalone installation and SLURM instructions are also available inside the app. See `../../packages/syncro/README.md` and its `validation/` directory for scientific behavior, installation and measured comparisons.

Run `pnpm --filter syncro test:e2e` for production workflow checks. The separately invoked `packages/syncro/validation/browser-run.mjs` runs the complete real scan and downloads its outputs. Repository-wide interface checks are required after a fresh site build.

Scientific browser assets use immutable Hugging Face revisions in `models/syncro.manifest.json`. The standalone npm archive includes the MNI template for offline jobs.

## SynthSR GPU reuse

Processing settings uses optimized WebGPU for SynthSR by default; CPU WebAssembly
remains available. The worker uses `@neurodesk/synthsr/browser`, shared with the
SynthSR app, and forwards the padded shape supplied by `runSynthsr`. This includes
the upstream v0.1.1 FP32 kernel fixes (`eeb9863`), model checksum validation, buffer
limits and GPU error handling. The model descriptor comes from the shared SynthSR
manifest. GPU provenance records `synthsr-blocked-fp32-v1`. SynthStrip and ANTs
continue on WASM in separate workers. No approximate tiling is enabled.

The earlier complete-pipeline container comparison used WASM; selecting GPU changes
the SynthSR backend and is covered separately by the inference-stage regression.
