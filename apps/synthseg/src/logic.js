// DOM-independent helpers, unit-tested under Node (see test/logic.test.js).
export const outputStem = (name) => name.replace(/\.nii(\.gz)?$/i, '');

// SynthSeg's CT path expects Hounsfield units; only CT scans store negatives.
export const looksLikeCt = (voxels) => voxels.some((value) => value < 0);
