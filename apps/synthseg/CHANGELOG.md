# synthseg

## 0.2.20260910

### Minor Changes

- Release the complete application catalog after integrating BrowserQC, dwi2trx and SynthSeg. Preserve shared interface behavior and publish bundles with synchronized date versions.
- 3fe15c3: Add SynthSeg brain segmentation in the browser and native executable. Pin model assets, preserve oblique NIfTI geometry, and protect cancelled processing from stale results. Share GPU inference and the standard imaging workspace.

### Patch Changes

- Validate full volumes on CPU and retain small Metal fixture coverage on memory-limited hosted macOS runners. Record validation device scope and partial failures, and include GPU memory context in native errors. Full-volume Metal validation still requires a suitable separate host.

- Updated dependencies [3fe15c3]
  - @neurodesk/runtime-support@0.1.1
  - @neurodesk/synthseg@0.2.20260910
