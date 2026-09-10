# Third-party notices

The release executable statically links and embeds the following. Exact
versions are pinned in `Cargo.lock`; the ONNX Runtime build is recorded by
`synthseg --self-check` and in every JSON sidecar.

## ONNX Runtime

Copyright (c) Microsoft Corporation. MIT License.
<https://github.com/microsoft/onnxruntime>. Static libraries are the
pyke-built distribution consumed by the `ort` crate
(`ort-sys/build/download/dist.tsv`, checksum-verified at build time).

## SynthSeg 2.0 model

Copyright Benjamin Billot and contributors. Apache-2.0.
<https://github.com/BBillot/SynthSeg>. Embedded as `synthseg-2.0.onnx`, a
lossless re-export of FreeSurfer 8.1.0 `models/synthseg_2.0.h5`.
