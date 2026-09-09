# SYNcro browser and standalone implementation plan

Status: implemented on 2026-09-08. This document preserves the initial design rationale. See [the implementation and validation report](../../packages/syncro/validation/README.md) for measured results and reproduction commands.

Implementation decisions that supersede proposals below:

- Registration compiles ANTs 2.6.2 itself with the ITK-Wasm toolchain. The browser and Node CLI use this same 3D float WebAssembly kernel; native ONNX Runtime handles the CLI neural networks.
- The existing SynthSR package and model are reused. A runtime-injected SynthStrip package matches the container's preprocessing and mask on the reference scan.
- As of 2026-09-09, the browser defaults to `@brainchop/mindgrab` with automatic WebGPU, WebGL2 and threaded-CPU selection. SynthStrip remains selectable and remains the standalone/HPC default. This intentionally differs from the initially validated container-compatible browser path.
- Acquired contrast is preserved, with float32 resampling outputs (original storage dtype is not preserved).
- The bundled MNI template and FSL license ship in the standalone tarball. Model revisions remain pinned to existing Hugging Face assets.
- One real T1 scan has completed stage and end-to-end comparisons. CT, broader pathology, oblique acquisitions and clinical suitability remain outside this initial validation.

## Recommended scope

Build MNI spatial normalization for one anatomical NIfTI scan, with optional accompanying lesion maps and images already aligned to that scan. Reuse `@neurodesk/synthsr` unchanged initially. Extract reusable SynthStrip processing from VesselBoost. Use ANTs SyN for registration, targeting WebAssembly in browsers and native execution on workstations/HPC through a shared orchestration package.

The first milestone is a registration feasibility experiment, before building the application interface. SynthSR conversion is complete; nonlinear registration is the main unresolved engineering and performance risk.

## Upstream behavior to reproduce

Reviewed [container recipe](https://github.com/neurodesk/neurocontainers/blob/f993bfd6ea658f6d56ba5f6a131e4a8c79b7e0e7/recipes/syncro/build.yaml) and [SYNcro.py](https://github.com/neurodesk/neurocontainers/blob/f993bfd6ea658f6d56ba5f6a131e4a8c79b7e0e7/recipes/syncro/SYNcro.py).

The script validates matching input geometry, synthesizes a T1 image, brain-extracts that image, and registers it to `MNI152_T1_1mm_brain.nii.gz` with `ants.registration(..., type_of_transform='SyN')`. The same transformation warps the original anatomical scan and accompanying images. It prefers SynthStrip, falling back to Brainchop/Mindgrab when SynthStrip is unavailable.

Compatibility details:

- Binary inputs receive 3 mm FWHM Gaussian smoothing before transformation, with zero dilation by default. They are generally interpolated linearly after smoothing, then binarized at the midpoint of the warped finite intensity range. This is not equivalent to directly warping labels with nearest-neighbor interpolation.
- Lesion images are propagated; the code does not pass them as registration exclusion masks or perform lesion filling.
- CT still runs SynthSR with its CT option, despite an inconsistent docstring. The script can infer CT from a minimum intensity below -500; the app should expose a modality choice with an override.
- The `--bet` flag is currently unused. Do not promise upstream behavior based on that flag.
- The recipe does not pin ANTsPy or the cloned SynthSR revision. Record the actual resolved executables, versions, model hashes, and registration parameters for the reference run.

## Reuse and new work

| Component | Existing implementation | Planned work |
| --- | --- | --- |
| SynthSR | `packages/synthsr`: shared pipeline, ONNX model, preprocessing, browser-safe entry point, native Node adapter, offline cache and provenance | Depend on the package; retain full-volume defaults and use optimized WebGPU synthesis by default. Reuse the published model without another conversion. |
| Browser inference infrastructure | `apps/synthsr/src/inference-worker.js` and model-loading code | Extract only the browser adapter/cache functionality required by both apps. Share model identity and verified downloads; avoid copying the worker wholesale. |
| Brain extraction | `apps/vesselboost/web/js/inference-worker.js`, `stepSynthStrip`; existing ONNX asset in `models/vesselboost.manifest.json` | Extract a runtime-injected `@neurodesk/synthstrip` package. Verify weights and full preprocessing/postprocessing against the container's SynthStrip before claiming parity. Use standard 1 mm processing initially, not VesselBoost's fast mode. |
| MindGrab | `@brainchop/mindgrab` 0.1.20260813 | Browser default with automatic WebGPU, WebGL2 and threaded-CPU fallback. Request the package's native-space binary mask with no added border. Keep SynthStrip available for comparison and container compatibility. |
| Registration | Local niimath provides rigid/affine wrappers; no verified local SyN backend | Evaluate ITKANTsWasm with a small ITK-Wasm wrapper, native build, and explicit registration settings. |
| Geometry and export | SynthSR scalar NIfTI reader and synthetic-image writer | Introduce a general volume/transform contract. Preserve original intensities and dtype; support float displacement fields and transform serialization. SynthSR's uint8 output writer is not a general registration writer. |
| Viewer and interface | SynthSR uses NiiVue `1.0.0-rc.11`; shared imaging workspace and app shell | Reuse the installed viewer integration and canonical app template. No separate NiiVue migration is needed for the initial app. |
| Distribution | SynthSR standalone npm tarball, model manifests, site release tooling | Apply the same pattern to SYNcro, including offline asset acquisition, CLI documentation and provenance. |

## Registration decision and feasibility gate

[ITKANTsWasm](https://github.com/InsightSoftwareConsortium/ITKANTsWasm/tree/1bc21eeb339da807d14ce5e5b250391a0bde6646) is the preferred candidate. Its [registration API](https://github.com/InsightSoftwareConsortium/ITKANTsWasm/blob/1bc21eeb339da807d14ce5e5b250391a0bde6646/include/itkANTSRegistration.h) supports SyN, configurable metrics and iteration schedules, and forward/inverse transforms. The inspected tree contains C++ and Python infrastructure; a ready-to-consume browser npm distribution was not established by this review. [ITK-Wasm](https://github.com/InsightSoftwareConsortium/ITK-Wasm) supplies infrastructure for compiling and running C++ pipelines in browsers and Node.js.

Build a narrow 3D registration and transform-application wrapper. Start with a small fixture, then an actual brain-to-MNI registration at the intended output resolution. Measure download size, initialization, peak memory, registration time, resampling time and cancellation behavior on a representative desktop browser. Compare native and WASM results using identical pinned settings, including precision, sampling and seed. Matching the name `SyN` alone is insufficient to match ANTsPy defaults.

Require a complete run, usable exported transforms, acceptable numerical/QC comparisons, and a documented memory/runtime envelope before committing to a browser release scope. Set numerical tolerances from reference variability and scientific review before accepting results. A coarse preview may be useful, but must be identified as a different preset.

Upstream [niimath qwarp](https://github.com/rordenlab/niimath/blob/3397d6b79459f371ed6a6912d6498d4caed94cfe/README.md#-qwarp-base) is an AFNI Qwarp port, not ANTs SyN. Its documentation explicitly describes it as impractically slow in WebAssembly and disabled by default. It is not the recommended shortcut. Existing affine registration remains useful for diagnostics, but affine-only output does not complete SYNcro's nonlinear workflow.

If the browser feasibility gate fails, use native ANTs for the complete standalone pipeline while resolving the WASM limitation. Any browser affine preview must be named accordingly; do not silently substitute algorithms or upload data to a server.

## Package and runtime design

Proposed layout:

```text
apps/syncro/                 shared shell, viewer, worker orchestration
packages/syncro/             pipeline API, CLI, parameters, provenance
packages/synthsr/            existing dependency
packages/synthstrip/         extracted and validated extraction pipeline
packages/registration/       SyN adapter, transform application, native/WASM builds
models/syncro.manifest.json  pinned template and additional asset metadata
```

The shared API should accept the anatomical volume, typed accompanying inputs, a template and backend adapters. Browser adapters use workers with optimized WebGPU synthesis and WASM CPU extraction/registration. Native Node adapters use ONNX Runtime CPU and a native registration executable/library; an external pinned ANTs executable is a reasonable initial HPC backend. Reuse SynthSR's offline cache and scheduler-aware thread configuration. A no-external-tools distribution requires packaging native registration artifacts for each supported platform.

Rust is optional. It could later wrap a native library or provide distribution conveniences, but a Rust rewrite of SyN is unnecessary for the initial application. The existing npm architecture already supports a standalone CLI without a browser or display.

Run stages sequentially, release inference sessions before registration, and avoid retaining duplicate full-volume buffers. Add stage checkpoints and provenance containing input hashes, model/template revisions, backend versions, parameters and timings. Support cancellation and explicit failures; never report a partial run as complete.

Use full affine geometry, not dimensions alone. Test RAS/LPS conversions, oblique images, transform direction/order, inverse transforms and displacement units. Estimate registration on the synthetic brain, then resample the original anatomical image from its own grid once using the composed physical-space transform. Accompanying files must declare whether they are continuous images, binary lesions or categorical labels. Preserve the original lesion behavior as a documented compatibility policy; categorical labels need nearest-neighbor interpolation without binary-lesion smoothing.

## Interface and outputs

Use the canonical app scaffold with one shared app bar and QSMbly-style progression:

1. Load anatomical scan; optionally add aligned images/lesions. Select MRI or CT.
2. Run normalization, with visible stage/status and expandable settings/logs. Permit inspection of the synthetic T1 and brain mask, and rerun from a checkpoint if needed.
3. Review MNI alignment using template/result overlays, opacity and synchronized slices. Clearly distinguish synthetic T1, warped acquired image and warped lesions.
4. Download results: warped original and accompanying images, synthetic brain, brain mask, forward/inverse transforms and JSON provenance. Include standalone/HPC instructions in a help disclosure.

Pin the exact MNI template, checksum and redistribution terms before hosting it. Use the existing model manifest/Hugging Face pattern for assets with appropriate attribution. Do not assume the container's overall license covers every model/template.

## Delivery sequence and acceptance

1. **Reference and registration experiment:** freeze a reproducible native SYNcro baseline; demonstrate native and browser SyN plus transform application on the same inputs. Decide browser resource limits from measurements.
2. **Reusable extraction and pipeline:** validate extracted SynthStrip; compose SynthSR, extraction, registration and typed image propagation in `@neurodesk/syncro`. Preserve existing SynthSR behavior.
3. **Standalone workflow:** provide CLI, offline asset download, SLURM example, thread/memory guidance, checkpoints and versioned installable artifacts. Test installation outside the monorepo.
4. **Browser workflow:** scaffold SYNcro, connect worker stages and NiiVue review/export, then exercise desktop and phone layouts against a fresh production build. Run `pnpm audit:interfaces`, `pnpm test:mobile` and `pnpm test:interface-workflows`; inspect screenshots and the actual data workflow.
5. **Scientific and release checks:** compare stage outputs and final registration against the pinned reference on representative MRI, anisotropic/oblique scans, CT and lesion cases. Include empty masks, categorical labels and geometry mismatch failures. Assess mask Dice, anatomical alignment, warped-lesion volume/overlap, inverse consistency and deformation Jacobians; visual review alone is insufficient. Publish measured resource limits and known differences before release.

Recommended first implementation task: a native/WASM SyN experiment using one already-generated SynthSR image, a validated brain mask and the exact MNI template. This tests the critical missing component without waiting for new UI or repeating model conversion work.
