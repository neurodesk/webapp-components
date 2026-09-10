#!/usr/bin/env python3
"""Compare two label maps: geometry, differing voxels, per-label Dice (worst 5)."""
import sys, numpy as np, nibabel as nib
a, b = nib.load(sys.argv[1]), nib.load(sys.argv[2])
x, y = a.get_fdata().astype(np.int32), b.get_fdata().astype(np.int32)
print("shape", a.shape, b.shape, "affine maxdiff", np.abs(a.affine - b.affine).max())
print("differing voxels", int((x != y).sum()), "of", x.size, f"({100*(x!=y).mean():.4f}%)")
dice = {l: 2 * ((x == l) & (y == l)).sum() / max(1, (x == l).sum() + (y == l).sum()) for l in np.unique(np.concatenate([x.ravel(), y.ravel()]))}
print("min dice", sorted(dice.items(), key=lambda kv: kv[1])[:5])
print("labels only in one:", set(np.unique(x)) ^ set(np.unique(y)))
