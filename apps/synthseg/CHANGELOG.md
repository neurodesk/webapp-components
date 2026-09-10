# synthseg

## 0.2.20260910

### Minor Changes

- Release the complete application catalog after integrating BrowserQC, dwi2trx and SynthSeg. Preserve shared interface behavior and publish bundles with synchronized date versions.
- 3fe15c3: Add SynthSeg brain segmentation in the browser and native executable. Pin model assets, preserve oblique NIfTI geometry, and protect cancelled processing from stale results. Share GPU inference and the standard imaging workspace.

### Patch Changes

- Updated dependencies [3fe15c3]
  - @neurodesk/runtime-support@0.1.1
  - @neurodesk/synthseg@0.2.20260910
