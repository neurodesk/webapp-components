# SynthSR

Synthesize a 1 mm isotropic T1-weighted brain image from a single MRI or CT NIfTI,
entirely in the browser. Images are not uploaded. NiiVue 1.0 RC displays the input
and synthetic result; the app downloads NIfTI and JSON processing details.
CPU / WebAssembly is selected by default; WebGPU remains available in Processing device.

## Run and build

From the monorepo root:

```sh
pnpm install
pnpm --filter synthsr dev
pnpm --filter synthsr build
pnpm --filter synthsr test
node scripts/audit-artifacts.mjs --app synthsr
```

The default app path is `/synthsr/`. The shared Vite helper configures COOP/COEP
headers for threaded WASM. GitHub Pages uses the shared, app-scoped COI
service-worker fallback, which reloads the first visit to enable isolation.
Without isolation CPU inference uses one thread. WebGPU inference runs in a dedicated module worker.

## Model assets

Large weights are excluded from Git and `dist/`. The manifest at
`models/synthsr.manifest.json` pins the validated ONNX file by SHA-256 and immutable
Hugging Face revision. The app downloads it from the public
[`sbollmann/neurodesk-webapps-assets` dataset](https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/tree/f6efb00454c5b3a687b0967cee96cf4c77af8ab9/synthsr).
No authentication is required. Successful downloads are checksum-verified
and cached using Cache Storage; cache/quota failures do not prevent inference.

For a local dev/production preview, keep the converted model in an external
folder, then run:

```sh
VITE_SYNTHSR_ASSET_BASE=/synthsr/model-assets/ SYNTHSR_ASSET_DIR=/absolute/path/to/converted-models pnpm --filter synthsr dev
VITE_SYNTHSR_ASSET_BASE=/synthsr/model-assets/ pnpm --filter synthsr build
SYNTHSR_ASSET_DIR=/absolute/path/to/converted-models pnpm --filter synthsr preview
```

Static builds use the published Hugging Face model by default. To use another
asset host, set `VITE_SYNTHSR_ASSET_BASE=https://<host>/<immutable-revision>/synthsr/`
at build time. It must allow CORS. Do not copy the 53 MB model into a Cloudflare Pages bundle.
The UI also accepts the validated `synthsr-v2.onnx` from a local file picker.
The demo FLAIR comes from the pinned upstream commit; override its URL using
`VITE_SYNTHSR_EXAMPLE_URL` if desired.

## Reproduce the model conversion

Use Python 3.10 and an isolated environment:

```sh
python3 -m venv .venv
.venv/bin/pip install -r apps/synthsr/scripts/requirements-convert.txt
curl -L https://raw.githubusercontent.com/neurolabusc/py_synthsr/04ab5548f4609c2b44ca51b3f4bc319b585dafa7/py_synthsr/cli.py -o /tmp/synthsr-reference.py
curl -L https://osf.io/download/jqdcm/ -o /tmp/synthsr-models.zip
unzip /tmp/synthsr-models.zip -d /tmp/synthsr-checkpoints
.venv/bin/python apps/synthsr/scripts/convert_model.py \
  --source /tmp/synthsr-reference.py \
  --checkpoint /tmp/synthsr-checkpoints/models/synthsr_v20_230130.h5 \
  --out /tmp/synthsr-assets
```

The converter builds the original Keras network, exports its trained weights to
standard ONNX operators, and compares ONNX Runtime CPU with TensorFlow on 32³ and
32×32×64 inputs. It preserves pre-BatchNorm skip connections, ELU order, and nearest
upsampling semantics. Decoder concat-convolutions are rewritten as two convolutions
plus addition to avoid a 72-channel full-resolution buffer, with no change to
image context. It writes the model, conversion metrics, and a tiny Conv3D /
MaxPool3D / Resize probe. There is no retraining or quantization.

Checkpoint SHA-256:
`a472f776e7b33b5ea6e10c801f55fee488f1477a208b3e6998dc1aec1d9c5f8b`.

## Scientific behavior

The shared `packages/synthsr/src/volume.js` implements the pinned Python reference:

- NIfTI scalar intensities, scaling, and affine geometry; single 3D input only.
- Resampling to 1 mm with the reference's anti-alias filtering, clamped linear
  interpolation, half-voxel origin adjustment, and NumPy arange endpoint behavior.
- Axis permutation/flipping to RAS, symmetric padding to multiples of 32,
  optional CT clipping to [0,80] HU, then min/max normalization.
- Network output multiplied by 255 and clipped to [0,128]; optional left-right
  flip averaging (enabled by default).
- Unpadding, optional sigma=1.5 unsharp masking (enabled by default), restoring
  the input orientation, multiplying by 2, clipping to [0,255], truncating to uint8.
- Output geometry uses the resampled input affine in an sform, in mm.

NaN/Infinity images, inputs with no variation after preprocessing, and multi-volume inputs are rejected.
Original input buffers are retained separately from output. Cancel terminates the
worker; a failed or cancelled run never enables download of a stale result.

Full-volume mode follows the reference computation. Tiled mode is an explicit,
approximate alternative: globally normalized 96³ patches with 32-voxel context
and a 32-voxel output stride, retaining original boundary padding. It changes
receptive-field context and can introduce seams. It is recorded in output filenames
and JSON provenance. It has not been validated for scientific equivalence.

SynthSR generates synthetic contrast and can fill lesions. Preserve the original
image for interpretation. No skull stripping or spatial normalization is performed.

## GPU execution

GPU processing uses the specialized `synthsr-blocked-fp32-v1` WebGPU executor in
`src/gpu-session.js`. Its FP32 Conv3D kernel computes 16 spatial positions × 32
output channels per workgroup, sharing input and weight tiles. All intermediate
activations stay channels-last on the GPU; eligible Conv/ELU and Add/ELU pairs
are fused, and buffers are reused after their last graph consumer. This is
execution tiling inside a convolution, not approximate image tiling: the full
spatial context, weights, skip connections and preprocessing remain the same.

The previous ONNX Runtime WebGPU path used `Conv3DNaive`; its full-example
measurements and the optimization evidence are recorded in
[`docs/performance-investigation.md`](docs/performance-investigation.md).
CPU/WASM remains the default and uses `onnxruntime-web@1.29.0` with the existing
Asyncify SIMD/threaded module. GPU reports identify `gpuImplementation`; CPU
reports identify `onnxRuntime`. GPU mode does not fall back to CPU on failure.

The executor supports only the checksum-pinned SynthSR graph. It verifies the
ONNX SHA-256 before reading initializer offsets from `src/gpu-model.json`; weights
are read from the original ONNX bytes, not a second model download. After changing
the validated model, regenerate this index with the conversion Python environment:

```sh
.venv/bin/python apps/synthsr/scripts/index_gpu_model.py /path/to/synthsr-v2.onnx
```

The generated graph/offset index is checked against the model manifest by unit
tests. Browser tests compare kernels against an independent scalar reference and
the complete pipeline against TensorFlow fixtures. The optional full-example
regression below exercises the largest activation buffers on hardware.

Full-volume memory remains substantial. The largest decoder tensor has 48
float32 channels after the concat-convolution rewrite; the app checks the GPU's
maximum buffer and binding sizes and conservatively rejects tensors at or above
2 GiB. The original graph produced incorrect full-volume output above this size
despite a 4 GiB adapter limit. The CPU path has its own WASM memory ceiling. Allocation failure is
reported; tiled mode is never silently substituted. Browser hardware determines
practical image size and throughput.

The full example's reusable GPU activation buffers total approximately 3.35 GiB,
plus weights and output readback. Session release destroys the GPU device and its
resources. Optional `createGpuSession(bytes, dims, {profile: true})` records per-pass
GPU timestamps in `session.profile` when the adapter supports timestamp queries;
normal application runs do not enable profiling.

## Validation

Spatial and network image fixtures in `test/fixtures` are synthetic. Spatial fixtures are independently
generated by `scripts/reference_fixtures.py` using the pinned Python source.
`test/volume.test.js` checks spatial/intensity parity, output geometry, CT,
orientation, invalid input, augmentation, scaling, and NIfTI serialization.
`test/fixtures/conversion.json` records native network export agreement.

The browser suite tests loading, cancellation, error recovery, and downloads.
When `SYNTHSR_ASSET_DIR` is provided it also runs the actual pretrained model and
compares output to the TensorFlow fixture. Run `pnpm --filter synthsr test:e2e`.

Regenerate the TensorFlow network fixture with:

```sh
.venv/bin/python apps/synthsr/scripts/network_reference.py \
  --source /tmp/synthsr-reference.py \
  --checkpoint /tmp/synthsr-checkpoints/models/synthsr_v20_230130.h5 \
  --input apps/synthsr/test/fixtures/validation.nii.gz \
  --output /tmp/validation-reference.nii.gz
```

The same script accepts `--onnx /tmp/synthsr-assets/synthsr-v2.onnx` instead of
`--checkpoint` for a native CPU reference on larger images. It uses the original
Python preprocessing/postprocessing, flip averaging and sharpening. `--no-flip`
disables augmentation. It also writes 10,000 deterministic sampled voxel values.

For the optional full-volume regression, set `SYNTHSR_HARDWARE_GPU=1`,
`SYNTHSR_FULL_INPUT=/path/to/input.nii.gz`, and
`SYNTHSR_FULL_REFERENCE=/path/to/reference.nii.gz` alongside `SYNTHSR_ASSET_DIR`
when running the browser suite. This requires a GPU with sufficient buffer limits
and memory; the default CI suite uses small synthetic volumes and software WebGPU.

Before the blocked-kernel optimization, on the public example FLAIR (padded shape 192×256×160), hardware WebGPU completed
single-pass synthesis in 98 seconds and matched the native reference at all
10,000 sampled output voxels. With default flip averaging and sharpening, the run
took 151 seconds: 297 of 6,598,560 output voxels differed by one uint8 intensity
step; all other voxels matched. Maximum affine error was 0.0000036 mm. See
`test/fixtures/browser-validation.json`. This validates that example and device; it is not
a clinical validation or a cross-device performance guarantee.

The optimized FP32 executor completed the same example with default flip and
sharpening in 17.78 seconds on the measured Apple GPU, including 7.25 seconds of
inference. Its output differed from the native reference by one uint8 step at
424 of 6,598,560 voxels, within the existing parity tolerance. See
[`docs/optimized-gpu-2026-09-08.json`](docs/optimized-gpu-2026-09-08.json) for
production-build timings, hardware details and validation scope.

## Standalone / HPC

Use **Run standalone / HPC** in the app for installation commands, offline model
prefetching and a Slurm job example. Every production build includes the standalone
npm tarball at `downloads/neurodesk-synthsr-0.1.0.tgz`; it installs independently
of this repository. No npm registry publication is needed.

The package is [`@neurodesk/synthsr`](../../packages/synthsr/README.md). Its Node.js
CLI uses native ONNX Runtime; the browser worker injects ONNX Runtime Web into the
same shared processing pipeline. The root package export is browser-safe and the
`/node` export provides filesystem processing and model caching. The scientific
model and default processing settings are identical in both applications.

```sh
# From the downloaded tarball, with Node.js 22+ available:
ONNXRUNTIME_NODE_INSTALL=skip npm install --global --prefix "$HOME/.local" ./neurodesk-synthsr-0.1.0.tgz
export PATH="$HOME/.local/bin:$PATH"
synthsr input.nii.gz output_synthsr.nii.gz --threads 8
```

Build the standalone tarball directly with `npm pack` in `packages/synthsr`, or
build the webapp to generate the downloadable artifact automatically. CPU is the
validated native backend; CUDA requires an appropriate provider installation and
compatible libraries and has not been tested on this host.

## Attribution

Apache-2.0. See LICENSE and NOTICE. Cite Iglesias et al., NeuroImage 237 (2021),
118206: https://doi.org/10.1016/j.neuroimage.2021.118206.
