# @neurodesk/registration

ANTs 2.6.2 compiled to WebAssembly for scalar 3D float SyN registration and transform application. It uses the actual ANTs optimizer and ITK resampler. The JavaScript adapter fixes the ANTsPy 0.6.1 `SyN` schedule, seed 42 and one ITK thread.

`createRegistration({createModule, wasmBinary, onLog})` initializes the module. `register({fixed,moving})` accepts NIfTI bytes and returns warped image bytes and affine/forward/inverse transform bytes. `apply({registration,moving,interpolation,fill})` resamples a scalar image with `linear` or `nearest` interpolation. Call `release(registration)` to remove its virtual-filesystem files. Run the synchronous optimizer in a dedicated worker and terminate that worker for cancellation.

The 11.53 MB kernel has a 4 GiB memory ceiling. On the real SYNcro test image it used a 3.16 GB linear heap and completed registration in 186 seconds in Node on the validation host. This is not total process RSS or a portable performance guarantee. On identical inputs it matched the published Neurodesk container's affine, displacement fields and resampled images exactly. See `../syncro/validation`.

## Rebuild

Docker, curl and tar are required. From the repository root:

```bash
bash packages/registration/scripts/build.sh /storage/tmp/syncro-registration-build
```

The script downloads a pinned ANTs source commit and uses a digest-pinned ITK-Wasm Emscripten image. Compilation may require substantial memory; one build job is used by default. The CMake wrapper supports only 3D float registration. Other template instantiations fail explicitly.

ANTs source commit: `52bc0ab588102682587303d31c720de94e6ef6c1`. The reference ANTsPy wheel was built with ITK 5.4.3; the WebAssembly toolchain supplies its own ITK build. Numerical equivalence is measured, not inferred from matching version labels. See `NOTICE` for attribution.
