# SYNcro

Normalize an anatomical NIfTI scan to the MNI152 1 mm brain template. The shared pipeline runs SynthSR, SynthStrip and ANTs SyN, then applies the transformation to the acquired scan and optional aligned images. It does not fill lesions or exclude them from registration.

## Standalone installation

Download `neurodesk-syncro-0.1.4.tgz` from the SYNcro webapp's **Standalone** dialog in the application bar. The artifact is built from `packages/syncro`; the website carries a tarball, not an npm registry publication. It includes the shared pipeline, ANTs WebAssembly kernel and MNI template. Neural-network models are downloaded separately, using pinned revisions and SHA-256 verification.

Node.js 22 or newer is required. No browser, display, Python or FreeSurfer installation is needed. ONNX Runtime's CPU binaries are installed through npm; `ONNXRUNTIME_NODE_INSTALL=skip` skips optional CUDA downloads, while retaining the package's CPU backend.

```bash
ONNXRUNTIME_NODE_INSTALL=skip npm install -g --prefix "$HOME/.local" ./neurodesk-syncro-0.1.4.tgz
export PATH="$HOME/.local/bin:$PATH"
syncro input.nii.gz results --threads 4
syncro input.nii.gz results-with-lesion --lesion lesion.nii.gz --labels labels.nii.gz
```

Use `--ct` for a CT image in Hounsfield units. Modality is explicit; there is no intensity-based CT autodetection. CT has not yet been validated against the reference container in this port.

## Offline HPC jobs

Install the npm package and prefetch models on a networked node:

```bash
syncro download-models --cache-dir /shared/syncro-models
```

Example SLURM script (adapt partitions, paths and resource requests to your system):

```bash
#!/bin/bash
#SBATCH --cpus-per-task=4
#SBATCH --mem=32G
#SBATCH --time=01:00:00
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
syncro /data/input.nii.gz /scratch/my-job/syncro \
  --threads "$SLURM_CPUS_PER_TASK" \
  --cache-dir /shared/syncro-models --offline
```

The CLI uses native ONNX Runtime CPU for synthesis and extraction. Registration uses the same single-threaded ANTs WebAssembly kernel as the webapp. `--threads` controls neural-network inference, not registration. The kernel has a 4 GiB linear-memory ceiling; the validated registration grew to 3.16 GB. Process memory also includes model sessions, image buffers and outputs. Start with 32 GB per job; this is a conservative request, not a measured peak-RSS guarantee. Use a separate process/output directory for each subject.

An output directory must be new. After interruption, `--resume` verifies input, software, models and stored checkpoint hashes, reuses completed SynthSR/SynthStrip stages, and reruns registration. It is not a resume within the optimizer. Changed input/options/software require a new output directory. Accompanying-image choices can change on resume because they do not affect synthesis or extraction.

## Images and outputs

All inputs must be scalar 3D NIfTI. Accompanying images must already share dimensions and affine geometry with the anatomical scan. Choose their meaning explicitly:

- `--image`: continuous intensities, linear interpolation.
- `--lesion`: values 0/1 only; 3 mm FWHM smoothing, linear interpolation, then midpoint threshold, matching SYNcro's binary propagation policy.
- `--labels`: nonnegative integer categories representable in float32; nearest-neighbor interpolation without smoothing.

Outputs include `synthetic-t1.nii`, `synthetic-brain.nii`, `brain-mask.nii`, `warped-synthetic-brain.nii.gz`, `warped-original.nii.gz`, accompanying outputs, `0GenericAffine.mat`, `1Warp.nii.gz`, `1InverseWarp.nii.gz`, and `provenance.json`. Original intensities are resampled once into MNI space as float32; original storage dtype is not preserved. Binary output is uint8.

Transforms use ANTs/ITK physical coordinates (LPS, displacement in mm). The forward ANTs transform list is `[1Warp.nii.gz, 0GenericAffine.mat]`. For MNI-to-subject application, use the inverse affine followed by the inverse warp according to ANTs' inverse-list convention: `[0GenericAffine.mat, 1InverseWarp.nii.gz]` with `whichtoinvert=[true,false]`. Do not interpret the displacement channels as voxel offsets.

## Development and validation

`pnpm --filter @neurodesk/syncro build` produces the self-contained package bundle. Building `apps/syncro` also packs it into `apps/syncro/dist/downloads/`. The shared `runSyncro` API injects inference, registration and progress adapters; Node's `normalize` API accepts filesystem paths.

See [validation/README.md](validation/README.md) for the real OpenNeuro scan, pinned Neurodesk container, exact stage comparisons, end-to-end differences and reproduction commands. Current evidence covers one real T1 scan and synthetic annotation fixtures, not clinical validation or broad modality/pathology coverage. Review the acquired image, brain mask and MNI alignment before using results.

Code is Apache-2.0 with upstream attribution. The MNI template has separate FSL non-commercial terms in `data/FSL-LICENSE.txt`.
