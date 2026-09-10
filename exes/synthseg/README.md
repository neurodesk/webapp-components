# synthseg

Self-contained native SynthSeg 2.0 executable. Reproduces FreeSurfer 8.1.0
`mri_synthseg --i IN --o OUT` with no Python, TensorFlow, FreeSurfer or model
files at run time: the checksum-pinned ONNX graph is embedded and ONNX Runtime
is statically linked. Apple Silicon macOS is the supported release; the source
builds anywhere the `ort` crate does.

```sh
synthseg --i T1_head.nii.gz --o seg.nii.gz      # default: flip averaging + topology cleanup
synthseg T1_head.nii.gz --fast                   # writes T1_head_synthseg.nii.gz, no flip/topology
synthseg ct.nii.gz out.nii.gz --ct               # clip Hounsfield units to [0, 80]
synthseg --self-check
```

Options: `--device cpu|metal` (default `metal` on macOS), `--threads N` (default:
all cores or `SLURM_CPUS_PER_TASK`), `--force`, `--quiet`. Output is an int32
label map on the 1 mm grid, like the Python tool; a JSON sidecar records
settings, model checksum, geometry and timings.

| Device | Runs | M4 Pro, 192×224×160, default / `--fast`, peak RSS |
| --- | --- | --- |
| `metal` | Native Metal port of the synthsr blocked FP32 Conv3D executor ([src/metal.rs](src/metal.rs)) | 6.6 s / 3.6 s, 3.4 GB |
| `cpu` | ONNX Runtime CPU provider, all cores | 14.6 s / 7.4 s, 14 GB |

`mri_synthseg` on the same volumes: 3:38 single-threaded, 27 s with 10 threads.
Blur, flip averaging, connected components and argmax run on the CPU for every
device ([src/post.rs](src/post.rs)); the GPU runs only the U-Net. The CPU path
will swap on a 16 GB machine (ORT arena); first fix would be arena options or
spatial tiling.

Not supported: `--robust`, `--parc`, `--qc`, `--v1`, `--photo`, `--keepgeom`,
`--crop`, `--autocrop`, `--vol`, `--post`, `--resample`, folder input, CUDA.

## Install (macOS)

Download `synthseg-VERSION-macos-arm64.pkg` and open it. The package is signed
with a Developer ID, notarized and stapled; it installs `/usr/local/bin/synthseg`.
Requires macOS 13.4 or later on Apple Silicon.

## Build

```sh
make check-model   # fetches the revision-pinned ONNX from Hugging Face into models/, verifies SHA-256
make build         # target/release/synthseg (build.rs re-verifies the model before embedding)
make test          # small fixture (test/fixtures), both modes, every device whose probe succeeds
make lint fmt
```

Requires current stable Rust. The first build downloads pyke's static ONNX
Runtime binaries for the host target.

Assets live in the Hugging Face dataset `neurodeskorg/webapps` under `synthseg/`
(`models/synthseg-2.0.onnx`, the upstream `synthseg_2.0.h5`, validation inputs
and goldens), pinned by commit in `packages/synthseg/model.manifest.json` and
`models/synthseg.manifest.json`. `scripts/repoint_model_manifest.sh COMMIT`
repins both. `make export` rebuilds the ONNX and the shared executor graph
index `packages/synthseg/src/gpu-model.json` from a FreeSurfer checkpoint
(python3 with h5py and onnx; no TensorFlow).

## Validation

The oracle is FreeSurfer 8.1.0 `mri_synthseg`. `make test-real` fetches
`T1_head.nii.gz` (1 mm) and `T1_head_2mm.nii.gz` (2 mm) plus their four
goldens into `$SYNTHSEG_REFERENCE_DIR` (default `~/src/synthseg-references`)
and runs both modes on every device. Gates ([tests/parity.rs](tests/parity.rs)):
identical geometry, header codes/units/quaternion equal, mismatch fraction
≤ 5e-6 on the fixture and ≤ 2e-6 on the real volumes (observed: 0–1 voxel of
5.6 M, fp32 accumulation order). Tighten, never loosen. The last run is in
[validation/report.json](validation/report.json). `make references` regenerates
goldens and the Keras preprocessing dump with a local FreeSurfer install;
`make test-keras` checks `volume.rs` against that dump (1e-5).

Engineering parity on named hardware, not clinical validation.

## Numerics, verified and load-bearing

- Preprocessing ([src/volume.rs](src/volume.rs)) runs in f64, matching NumPy;
  only the final model input is cast to f32. Percentiles use
  `select_nth_unstable` plus NumPy's two-form `_lerp`, so `robust_min/max`
  equal `np.percentile` bit for bit. The `(start + step) - start` arithmetic
  in `resample_1mm` reproduces `np.arange` rounding on purpose.
- The sigma-0.5 posterior blur runs in `--fast` too; only flip averaging and
  topology cleanup are skipped there.
- ONNX `Concat` skip connections are the conv outputs before BatchNorm.
- Connected components are 6-connected (`scipy.ndimage.label` default).
- `post::LABELS` (33) is `np.unique` of the 55-entry
  `synthseg_segmentation_labels_2.0.npy`; `FLIP` and `TOPOLOGY` come from
  `get_flip_indices()` and `synthseg_topological_classes_2.0.npy[unique_idx]`,
  verified by numpy recomputation.
- Metal pads conv output channels to a multiple of 4 (33 → 36); Softmax reads
  only the logical 33. `--features metal-f16` changed 188 voxels for no
  speedup and stays off.
- Output header mirrors nibabel: input `qform_code`/`sform_code`/`xyzt_units`
  carried through; a resampled input gets codes (0, 2); units 0 becomes mm; a
  qform-only input gets `sform_code` 1; the quaternion is always written; both
  codes 0 uses nibabel's fallback affine.
- ORT output is NCDHW; Metal's voxel-major output is transposed to
  channel-major on readback, so `main.rs` sees one layout.
- Input hardening: `vox_offset` validated, gzip expansion capped at 2 GB,
  64 M-voxel / i16 dim guard before any allocation, non-finite `scl_slope`
  treated as unscaled.

## Traps

- `build.rs` requires `models/synthseg-2.0.onnx` and checks it against the
  manifest; a stale `.onnx` fails the build rather than loading silently.
- `make macos-pkg` needs an interactive keychain prompt for the Installer
  identity; it cannot run unattended.
- `scripts/keras_reference.py` runs under `fspython`, on `PATH` only after
  `. $FREESURFER_HOME/SetUpFreeSurfer.sh`.

## Release macOS locally

```sh
make macos-notary-profile APPLE_ID='you@example.com' TEAM_ID='ABCDE12345'   # once
EXPECTED_TEAM_ID=ABCDE12345 make macos-release VERSION=0.1.20260910
```

Identities default to the Developer ID certificates in the Keychain;
`NOTARY_PROFILE` defaults to `synthseg-notary` (pass `NOTARY_PROFILE=...` to
reuse an existing profile). `macos-release` checks the profile, runs `test` and
`test-real`, signs, builds the `.pkg`, notarizes, staples and verifies;
`make macos-pkg-adhoc` writes an unsigned package for local testing.

## Citation

Billot B, Greve DN, Puonti O, et al. (2023). SynthSeg: Segmentation of brain
MRI scans of any contrast and resolution without retraining. Medical Image
Analysis 86:102789. https://doi.org/10.1016/j.media.2023.102789

Apache-2.0. See LICENSE, NOTICE and THIRD_PARTY_NOTICES.md.
