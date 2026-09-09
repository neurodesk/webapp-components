# MNI reference template

`MNI152_T1_1mm_brain.nii.gz` is the exact template used by the pinned Neurodesk SYNcro container, supplied by FSL courtesy of MNI. Its redistribution and use are governed separately by `FSL-LICENSE.txt` (non-commercial terms).

FSL source: https://git.fmrib.ox.ac.uk/fsl/data_standard/-/tree/f6db877e56047a1ad91fd9b28d38654376087029

Compressed bytes: 3,219,212. SHA-256: `32d5be33460f995a5d305507053c8862c823d9ca6bfb543381308df14590f212`.

Decompressed NIfTI bytes: 14,442,416. SHA-256: `18576c0190c0f6496f3d4a6bf40cfd6e9cddb4b6eaa8517bb0af2b88ff67c0c5`.

Some static hosts send `.nii.gz` as HTTP `Content-Encoding: gzip`. Browser fetch then returns the second representation. The worker verifies the matching length and checksum for either representation; it does not skip integrity checks.
