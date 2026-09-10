# @neurodesk/synthseg

SynthSeg 2.0 brain segmentation for browsers: FreeSurfer labels from any MRI
contrast or resolution, no retraining. Preprocessing and postprocessing are
`exes/synthseg`'s Rust modules compiled to WebAssembly — `wasm/src/lib.rs`
includes `nifti.rs`, `volume.rs` and `post.rs` by `#[path]` rather than copying
them, so browser output is bit-identical to the native CLI. Inference is the
caller's: `./browser` runs the shared WebGPU U-Net executor, and the Node tests
run onnxruntime-node.

```js
import { runSynthseg, loadSynthseg } from '@neurodesk/synthseg';
import { createBrowserSession, browserRuntime } from '@neurodesk/synthseg/browser';
import wasmUrl from '@neurodesk/synthseg/wasm?url';

const wasm = await loadSynthseg(fetch(wasmUrl));
const { buffer, provenance } = await runSynthseg({
  buffer,                       // ArrayBuffer of a .nii/.nii.gz
  options: { fast: false, ct: false },
  wasm,
  loadModel: async () => ({ bytes, hash }),   // synthseg-2.0.onnx, see model.manifest.json
  createSession: createBrowserSession,
  onProgress: (fraction, message) => {},
  runtime: browserRuntime(),
});
// buffer: .nii.gz int32 FreeSurfer labels on the 1 mm grid. provenance: the CLI's JSON sidecar fields.
```

`fast` skips left–right flip averaging and topology postprocessing (roughly half
the work, slightly noisier labels). `ct` clips Hounsfield units to [0, 80].

## Build and test

    make wasm    # cargo build --target wasm32-unknown-unknown + wasm-opt -O3 -> src/synthseg.wasm
    make test    # fixture parity against the FreeSurfer 8.1.0 goldens (needs exes/synthseg/models/synthseg-2.0.onnx)

`src/synthseg.wasm` is committed (as `packages/runtime-support/src/niimath` is),
so `make wasm` is only needed when the Rust changes. Without the model `make test`
still runs the wasm geometry check (catches ABI drift). Parity on the benchmark
volumes: `SYNTHSEG_REFERENCE_DIR=~/src/synthseg-references make test`.

The wasm ABI is plain C exports (`seg_new`, `seg_error_*`, `seg_input`, `seg_flipped_input`,
`seg_labels`, `seg_free`) plus typed accessors `seg_padded`, `seg_input_dims`,
`seg_output_dims` (u32×3) and `seg_affine` (f64×12); `src/wasm.js` assembles
`Segmenter.geometry` from them — no JSON crosses the boundary.

## Memory

The 33 posterior channels of a 1 mm head are ~0.9 GB, and the default mode holds
two sets while averaging, so the module is linked with `--max-memory=4 GiB` and
needs a 64-bit browser. `fast` mode halves the peak.

## Measured (Apple M4 Pro, Chromium via Metal, 192×224×160)

| Volume | Mode | Mismatched voxels | Wall time |
| --- | --- | --- | --- |
| T1_head | default | 1 of 5.6 M | 9.6 s |
| T1_head | fast | 0 | 7.7 s |
| T1_head_2mm | default | 0 | 9.3 s |
| T1_head_2mm | fast | 1 | 5.6 s |

Same mismatch counts as the native Metal executor (`exes/synthseg/validation/report.json`);
last run in `apps/synthseg/validation/report.json`. Inference is 6.3 s of the default run and
WASM postprocessing 3.0 s, so postprocessing is not the bottleneck. Planned GPU buffers total
5.2 GB (largest 1.85 GB, the full-resolution 72-channel concat); the largest volume under a
4 GB `maxBufferSize` is about 256×256×224. Engineering parity on named hardware, not a
performance claim.
