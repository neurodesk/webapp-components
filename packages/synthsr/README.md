# @neurodesk/synthsr

SynthSR v2 brain image synthesis for standalone computers, HPC jobs and browsers.
Node.js 22+ runs the pretrained model with **native ONNX Runtime**, without Python,
a browser, a display server or a service. The Neurodesk SynthSR webapp imports the
same spatial processing, inference, augmentation and serialization code.

## Install the standalone npm package

Download `neurodesk-synthsr-0.1.0.tgz` from **Run standalone / HPC** in the SynthSR
webapp. This package has not been published to the npm registry; install the
provided tarball. On a networked Linux machine, install for your own user:

```sh
ONNXRUNTIME_NODE_INSTALL=skip npm install --global --prefix "$HOME/.local" ./neurodesk-synthsr-0.1.0.tgz
export PATH="$HOME/.local/bin:$PATH"
synthsr --help
synthsr input.nii.gz output_synthsr.nii.gz --threads 8
```

`ONNXRUNTIME_NODE_INSTALL=skip` skips optional provider downloads; the npm package
already includes native CPU binaries. Node.js and the native dependency must
support your operating system/architecture. Native CPU inference is tested on
Linux x64. No Hugging Face authentication is needed.

The first run downloads the 53 MB model from an immutable Hugging Face revision
and verifies its SHA-256. The image is processed locally. Output is `.nii` or
`.nii.gz` plus a JSON sidecar containing the model hash, settings, geometry,
thread count, runtime version and separate stage timings. Output defaults to
`INPUT_synthsr.nii.gz`. Existing files are rejected unless `--force` is supplied;
overwriting the input is always rejected.

## Offline and HPC execution

Install Node.js and this package on a networked node with the **same operating
system and architecture** as the compute nodes. Store the installation and model
cache on a shared filesystem, or copy them to the compute node. Native dependencies
must be installed before entering an offline job; `--offline` controls model access.

```sh
# Networked login node; choose your own shared cache directory.
synthsr download-model --cache-dir /shared/synthsr-models

# Compute node: no network request is made.
synthsr input.nii.gz output_synthsr.nii.gz \
  --cache-dir /shared/synthsr-models --offline --threads 8

# Alternatively, provide the validated ONNX file directly.
synthsr input.nii.gz output_synthsr.nii.gz \
  --model /shared/synthsr-v2.onnx --offline --threads 8
```

The default cache is `$XDG_CACHE_HOME/neurodesk/synthsr`, or
`~/.cache/neurodesk/synthsr`, with a model-hash subdirectory. Concurrent downloads
use unique temporary files and atomic rename; incomplete downloads never become
cached models. Corrupt or mismatched model files are rejected.

Example `synthsr.sbatch` (adapt paths, modules, memory and time to your cluster):

```bash
#!/bin/bash
#SBATCH --job-name=synthsr
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=00:30:00
set -euo pipefail
# Load your site's Node.js 22+ module here if required.
export PATH="$HOME/.local/bin:$PATH"
synthsr /shared/input.nii.gz /shared/output_synthsr.nii.gz \
  --cache-dir /shared/synthsr-models --offline \
  --threads "$SLURM_CPUS_PER_TASK"
```

Submit with `sbatch synthsr.sbatch`. Without `--threads`, the CLI respects
`SLURM_CPUS_PER_TASK`, otherwise uses up to four available CPUs. Use one job per
image or a job array with a unique output path for each image. Memory depends on
resampled dimensions; 32 GB is an example resource request, not a fixed requirement.

## Options and scientific behavior

Run `synthsr --help` for the complete interface. Defaults are MRI, full-volume
inference, left–right averaging and sharpening. `--ct` clips CT intensities to
[0,80] HU. `--no-flip` and `--no-sharpen` disable the corresponding operations.
`--tiled` uses approximate 96³ patches and changes receptive-field context; it can
introduce seams. Tiled mode is recorded in provenance and default output names.

`--device cpu` is the tested default. `--device cuda` selects the native CUDA
provider and disables CPU fallback. It requires a CUDA-enabled ONNX Runtime
installation plus compatible CUDA/cuDNN libraries, and was not validated on this
host. The CPU-only installation above skips optional providers; see the pinned
[ONNX Runtime Node installation script](https://github.com/microsoft/onnxruntime/blob/v1.29.0/js/node/script/install.js)
and [CUDA requirements](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
when preparing a GPU installation. This is native CUDA, not browser WebGPU.

The package preserves the pinned Python implementation's 1 mm resampling, RAS
alignment, multiple-of-32 padding, intensity normalization, network scaling,
flip averaging, sharpening, restored orientation and uint8 serialization.
Synthetic contrast may alter or fill lesions; preserve original scans for
interpretation. No skull stripping or spatial normalization is performed.

## JavaScript API

Install the tarball as a project dependency with `npm install ./neurodesk-synthsr-0.1.0.tgz`.

```js
import { synthesize } from '@neurodesk/synthsr/node';
const result = await synthesize({
  input: 'input.nii.gz', output: 'output_synthsr.nii.gz',
  threads: 8, device: 'cpu', offline: true, modelPath: '/shared/synthsr-v2.onnx',
  onProgress: (fraction, message) => console.error(message),
});
console.log(result.output, result.reportPath, result.provenance.timings);
```

The browser-safe root export exposes `runSynthsr`, spatial helpers and `runTiled`.
`runSynthsr` accepts NIfTI bytes, the runtime's Tensor class, a model loader and a
session factory. Only `@neurodesk/synthsr/node` imports Node filesystem/native APIs.

## Build and validate from the monorepo

```sh
pnpm install
pnpm --filter @neurodesk/synthsr test
pnpm --filter synthsr test
pnpm --filter synthsr build
```

The app build creates `apps/synthsr/dist/downloads/neurodesk-synthsr-0.1.0.tgz`.
To package just this library, run `npm pack` inside `packages/synthsr`. The tarball
contains its own pinned model manifest, source, CLI and attribution. It has no
workspace dependencies and excludes model weights, test images and web assets.
The canonical manifest lives at `models/synthsr.manifest.json`; keep this package's
copy synchronized (covered by the repository test).

Set `SYNTHSR_MODEL_PATH=/path/to/synthsr-v2.onnx` for the native numerical parity
test. The app's browser suite compares the same TensorFlow fixture on WASM and
WebGPU. Spatial fixtures cover anisotropic/permuted geometry, CT and NIfTI scaling.

The independently installed tarball also completed the full public FLAIR example
offline using two CPU threads. Across 6,598,560 output voxels, 102 differed from
the saved native reference by one uint8 intensity step and all others matched.
This is engineering parity evidence, not clinical validation. Details are recorded
in `test/native-validation.json` in the source repository.

Apache-2.0. See LICENSE and NOTICE. Model attribution: Iglesias et al., NeuroImage
237 (2021), 118206. https://doi.org/10.1016/j.neuroimage.2021.118206.

## Shared browser GPU runtime

`@neurodesk/synthsr/browser` exports `createBrowserSession(ort, bytes, backend, paddedShape)`
and `browserRuntime(backend)`. Both SynthSR and SYNcro use this adapter with the shared
`runSynthsr` pipeline. SYNcro selects WebGPU by default; the adapter defaults to WASM when no backend is supplied. The `webgpu` backend runs the
checksum-pinned `synthsr-blocked-fp32-v1` executor from upstream commit `eeb9863`,
with blocked FP32 Conv3D, fused activations and graph-lifetime buffer reuse. It does
not fall back to ONNX Runtime GPU or CPU when the GPU cannot run the volume.

Pass the pipeline's session arguments through unchanged so GPU allocation uses the
prepared/padded dimensions. Supply the app's own ONNX Runtime instance and WASM URLs;
use `browserRuntime` in provenance to distinguish the custom GPU executor from ORT.
The GPU graph index and kernels ship inside this npm package; no additional model
weights are required. Native Node/HPC CPU and CUDA execution still uses `./node`.
