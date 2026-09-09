# SYNcro webapp

Local browser normalization: SynthSR → MindGrab (default) or SynthStrip → ANTs SyN → resampling of acquired images into MNI space. Uses NiiVue 1.0.0-rc.11, the shared imaging workspace and optimized WebGPU synthesis by default.

From the repository root:

```bash
pnpm --filter syncro build
pnpm --filter syncro preview --host 127.0.0.1 --port 5175
```

Open `/syncro/`. Use a desktop browser with cross-origin isolation and several GB of available memory. The bundled service worker supplies isolation on compatible static hosts. No input images are sent to a processing service. Hugging Face supplies pinned models, and the optional real example comes from OpenNeuro.

The build emits registration assets, template licensing information and `downloads/neurodesk-syncro-0.1.3.tgz`. The app's Standalone disclosure provides copyable download, installation and run commands. See `../../packages/syncro/README.md` and its `validation/` directory for scientific behavior, installation and measured comparisons.

Run `pnpm --filter syncro test:e2e` for production workflow checks. The separately invoked `packages/syncro/validation/browser-run.mjs` runs the complete real scan and downloads its outputs. Repository-wide interface checks are required after a fresh site build.

Scientific browser assets use immutable Hugging Face revisions in `models/syncro.manifest.json`. The standalone npm archive includes the MNI template for offline jobs.

## Brain extraction

The browser defaults to `@brainchop/mindgrab` 0.1.20260813. Its automatic backend tries WebGPU, WebGL2 and then threaded CPU; SYNcro runs it inside the existing inference worker so a synchronous WebGL2 run does not block the interface. The package's six MindGrab runtime assets (JavaScript glue plus WASM for three backends) are copied into the production build at `mindgrab/`, adjacent and unhashed as required by the package. SynthStrip remains selectable and continues to be the standalone/HPC extractor.

The installed MindGrab package is 3.2 MB compressed and 4.5 MB unpacked for both models and all backends. The MindGrab-only browser runtime assets shipped by SYNcro total 2.52 MB; a selected backend loads 0.81–0.88 MB. SynthStrip's selected browser ONNX model is 10.30 MB, excluding ONNX Runtime that SYNcro already needs for SynthSR. This makes all three MindGrab backends together 4.1× smaller than the SynthStrip model; the individual CPU runtime is 12.7× smaller.

Runtime comparisons must name the hardware and backend. The first paired repository benchmark on the same synthesized T1 in 16-thread Linux headless Chromium measured MindGrab CPU at 72.85 s and SynthStrip WASM at 68.47 s. A repeat in fresh, isolated Chromium processes measured 72.61 s and 76.89 s respectively; that reversal illustrates the noise on this shared host. In the repeat, aggregate browser-process-tree peak RSS was 3.24 GiB for MindGrab and 4.40 GiB for SynthStrip. After subtracting each loaded app's idle baseline, their peak increases were 2.82 GiB and 4.00 GiB, making MindGrab's incremental peak 29.4% lower. RSS can count shared pages more than once, so treat it as a consistent within-host comparison rather than unique physical memory. The upstream MindGrab package reports 2.4 s WebGPU, 4.1 s WebGL2 and 12.6 s threaded CPU per call on an Apple M4 Pro. See [`packages/syncro/validation/results/brain-extraction-benchmark.json`](../../packages/syncro/validation/results/brain-extraction-benchmark.json) and rerun it with `benchmark-brain-extraction.mjs`; do not present one machine/backend as a universal runtime claim.

## SynthSR GPU reuse

Processing settings uses optimized WebGPU for SynthSR by default; CPU WebAssembly
remains available. The worker uses `@neurodesk/synthsr/browser`, shared with the
SynthSR app, and forwards the padded shape supplied by `runSynthsr`. This includes
the upstream v0.1.1 FP32 kernel fixes (`eeb9863`), model checksum validation, buffer
limits and GPU error handling. The model descriptor comes from the shared SynthSR
manifest. GPU provenance records `synthsr-blocked-fp32-v1`. SynthStrip, when selected,
and ANTs continue on WASM in separate workers; MindGrab selects its own browser
backend. No approximate tiling is enabled.

The earlier complete-pipeline container comparison used WASM; selecting GPU changes
the SynthSR backend and is covered separately by the inference-stage regression.

Scan pickers accept NIfTI and complete DICOM series through the shared local
converter. Choose one anatomical series at a time; accompanying series become
individual images whose propagation type can be selected. ONNX models are
downloaded from their checksum-pinned published locations.
