# Third-party notices

The release executable statically links and embeds the following. Exact
versions are pinned in `Cargo.lock`; the ONNX Runtime build is recorded by
`synthsr --self-check` and in every JSON sidecar.

## ONNX Runtime

Copyright (c) Microsoft Corporation. MIT License.
<https://github.com/microsoft/onnxruntime>. Static libraries are the
pyke-built `ms@1.28.0` distribution consumed by the `ort` crate
(`ort-sys/build/download/dist.tsv`, feature set `coreml,webgpu`, checksum-verified
at build time).

## Dawn

`libwebgpu_dawn.dylib` (installed to `/usr/local/lib/synthsr/`) is Google's
Dawn WebGPU implementation, BSD-3-Clause, <https://dawn.googlesource.com/dawn>,
as built and distributed by pyke alongside the ONNX Runtime binaries above. It
is loaded only for `--device webgpu`.

## Rust crates

- `ort`, `ort-sys` — pyke, MIT OR Apache-2.0.
- `flate2`, `miniz_oxide` — MIT OR Apache-2.0 (miniz_oxide also Zlib).
- `sha2` — RustCrypto, MIT OR Apache-2.0.
- `serde`, `serde_json` — MIT OR Apache-2.0.

## SynthSR model

`synthsr-v2.onnx` (SHA-256
`276151128c666f81eba80a6afb7f307aa3c7d58825748029ba67cf170f1460a3`) is the
ONNX conversion of `synthsr_v20_230130.h5` from
<https://github.com/BBillot/SynthSR>, Apache-2.0, redistributed under the same
terms as the SynthSR web application (see NOTICE).
