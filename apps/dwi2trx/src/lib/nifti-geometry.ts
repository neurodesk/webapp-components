/**
 * NIfTI-1 geometry helpers — pure, read-side, no DOM/NiiVue. Neutral home so both
 * the writer overlays and the tracking reader can share without coupling.
 */

/**
 * Voxel→world affine from a NIfTI-1 header's qform (quaternion), as three
 * spatial rows `[srow_x, srow_y, srow_z]` (the 4th `[0,0,0,1]` is implicit).
 * Returns null if there's no qform (`qform_code <= 0`). Quaternion→matrix per
 * nifti1.h. `dv` must be positioned at the start of the 348-byte header.
 *
 * Tools that read only the sform (the streamline tracker's voxel→RASMM) silently
 * mishandle FSL-preprocessed DWI, which is commonly qform-only (sform_code = 0).
 * This recovers the geometry they need.
 */
export function qformAffineRows(dv: DataView): number[][] | null {
  const LE = true
  if (dv.getInt16(252, LE) <= 0) return null // qform_code
  let qfac = dv.getFloat32(76, LE)
  if (qfac === 0) qfac = 1
  const dx = dv.getFloat32(80, LE)
  const dy = dv.getFloat32(84, LE)
  const dz = dv.getFloat32(88, LE)
  let b = dv.getFloat32(256, LE)
  let c = dv.getFloat32(260, LE)
  let d = dv.getFloat32(264, LE)
  const ox = dv.getFloat32(268, LE)
  const oy = dv.getFloat32(272, LE)
  const oz = dv.getFloat32(276, LE)
  // Recover the scalar part a. Per nifti1.h, a quaternion that rounds slightly
  // over unit length (b²+c²+d² > 1) is renormalized and a set to 0 — clamping
  // a alone would leave b/c/d over-length and skew the rotation. (b=c=d=0 gives
  // a=1, no divide-by-zero.)
  let a = 1 - (b * b + c * c + d * d)
  if (a < 1e-7) {
    const s = 1 / Math.sqrt(b * b + c * c + d * d)
    b *= s
    c *= s
    d *= s
    a = 0
  } else {
    a = Math.sqrt(a)
  }
  // Rotation from the unit quaternion (a,b,c,d), columns scaled by voxel size;
  // the z column is also scaled by qfac (left/right-handed flag).
  return [
    [
      (a * a + b * b - c * c - d * d) * dx,
      2 * (b * c - a * d) * dy,
      2 * (b * d + a * c) * dz * qfac,
      ox,
    ],
    [
      2 * (b * c + a * d) * dx,
      (a * a + c * c - b * b - d * d) * dy,
      2 * (c * d - a * b) * dz * qfac,
      oy,
    ],
    [
      2 * (b * d - a * c) * dx,
      2 * (c * d + a * b) * dy,
      (a * a + d * d - b * b - c * c) * dz * qfac,
      oz,
    ],
  ]
}

/**
 * Voxel→world (RASMM) 4×4 affine (row-major) from a NIfTI-1 header `DataView`:
 * prefer the sform, fall back to the qform (FSL-preprocessed DWI is often
 * qform-only — without this a derived tractogram lands in the wrong world space
 * and no longer aligns with the image), else a pixdim-scaled diagonal.
 */
export function readAffine(dv: DataView): number[][] {
  const LE = true
  if (dv.getInt16(254, LE) > 0) {
    const row = (o: number): number[] => [
      dv.getFloat32(o, LE),
      dv.getFloat32(o + 4, LE),
      dv.getFloat32(o + 8, LE),
      dv.getFloat32(o + 12, LE),
    ]
    return [row(280), row(296), row(312), [0, 0, 0, 1]] // srow_x / y / z
  }
  const qform = qformAffineRows(dv)
  if (qform) return [...qform, [0, 0, 0, 1]]
  // Neither form: pixdim-scaled diagonal, origin at voxel 0.
  const px = (o: number) => dv.getFloat32(o, LE) || 1
  return [
    [px(80), 0, 0, 0],
    [0, px(84), 0, 0],
    [0, 0, px(88), 0],
    [0, 0, 0, 1],
  ]
}

/** Determinant of the 3×3 rotation/scale block of a voxel→world affine. */
export function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}
