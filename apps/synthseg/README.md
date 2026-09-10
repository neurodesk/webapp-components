# SynthSeg (web)

Segments a 3D brain scan into FreeSurfer labels in the browser. Preprocessing,
post-processing and NIfTI I/O are the native CLI's Rust compiled to WASM
(`@neurodesk/synthseg`); the U-Net runs on WebGPU through the shared
`@neurodesk/runtime-support/gpu-unet` executor.

WebGPU is required — there is no WASM fallback. Without it the app says so and
Run stays disabled.

## Controls

- **Input image** — NIfTI or DICOM (drag-drop supported), or the `T1_head` example.
- **Mode** — `default` reproduces the reference output (flip averaging plus
  topological correction); `fast` is a single pass.
- **CT** — auto-checked when the loaded image contains negative intensities.
- **Output** — label-overlay opacity, `<stem>_synthseg.nii.gz`, `<stem>_synthseg.json`.

## Develop

```sh
pnpm --filter synthseg dev      # SYNTHSEG_ASSET_DIR=<dir with synthseg-2.0.onnx> to serve the model locally
pnpm --filter synthseg test
pnpm --filter synthseg lint
pnpm --filter synthseg build
pnpm --filter synthseg test:e2e # needs a WebGPU-capable Chromium
```

The model is fetched from Hugging Face and cached (Cache API) after a SHA-256
check against `models/synthseg.manifest.json`; it is never bundled.

## Validation

`SYNTHSEG_E2E_FIXTURE=1 SYNTHSEG_HARDWARE_GPU=1 SYNTHSEG_ASSET_DIR=../../exes/synthseg/models SYNTHSEG_REFERENCE_DIR=~/src/synthseg-references pnpm --filter synthseg test:e2e`
runs the small fixture and both benchmark volumes through the built app on the real GPU and
gates them like the native CLI (mismatch ≤ 2e-6, identical geometry). The last run is in
`validation/report.json`: 0–1 of 5.6 M voxels differ from FreeSurfer, 6–10 s per volume on an
M4 Pro.

## Standalone

The native CLI is `exes/synthseg` in this repository.
