/** qformAffineRows: derive the voxel→world affine from a NIfTI-1 qform.
 *  Run: node --experimental-strip-types src/lib/nifti-geometry.test.ts */
import assert from 'node:assert/strict'
import { det3, qformAffineRows, readAffine } from './nifti-geometry.ts'

const LE = true
const near = (got: number, want: number, msg: string) =>
  assert.ok(Math.abs(got - want) < 1e-3, `${msg}: got ${got}, want ${want}`)

/** A minimal NIfTI-1 header DataView with the given qform fields. */
function header(opts: {
  qfac?: number
  vox?: number
  b?: number
  c?: number
  d?: number
  off?: [number, number, number]
}): DataView {
  const dv = new DataView(new ArrayBuffer(352))
  dv.setInt32(0, 348, LE)
  dv.setFloat32(76, opts.qfac ?? 1, LE) // pixdim[0] = qfac
  for (const o of [80, 84, 88]) dv.setFloat32(o, opts.vox ?? 1.8, LE) // pixdim x/y/z
  dv.setInt16(252, 1, LE) // qform_code
  dv.setFloat32(256, opts.b ?? 0, LE)
  dv.setFloat32(260, opts.c ?? 0, LE)
  dv.setFloat32(264, opts.d ?? 0, LE)
  const off = opts.off ?? [0, 0, 0]
  dv.setFloat32(268, off[0], LE)
  dv.setFloat32(272, off[1], LE)
  dv.setFloat32(276, off[2], LE)
  return dv
}

const colNorm = (m: number[][], c: number, vox: number) =>
  Math.hypot(m[0][c], m[1][c], m[2][c]) / vox

// 1. Canonical case: quat (0,0,1) = 180° about z, 1.8 mm, with offsets — matches
//    the HBN space-T1w DWI that exposed the qform-only bug. R = diag(-1,-1,1).
{
  const rows = qformAffineRows(header({ d: 1, off: [95.3, 102.7, -85.2] }))
  assert.ok(rows, '180z: rows returned')
  near(rows[0][0], -1.8, '180z srow_x[0]')
  near(rows[0][3], 95.3, '180z srow_x[3]')
  near(rows[1][1], -1.8, '180z srow_y[1]')
  near(rows[1][3], 102.7, '180z srow_y[3]')
  near(rows[2][2], 1.8, '180z srow_z[2]')
  near(rows[2][3], -85.2, '180z srow_z[3]')
}

// 2. qfac = -1 flips the z column (left-handed storage). Same 180z rotation,
//    the third column is negated relative to qfac=+1.
{
  const rows = qformAffineRows(header({ d: 1, qfac: -1 }))
  assert.ok(rows, 'qfac: rows returned')
  near(rows[2][2], -1.8, 'qfac=-1 negates z column')
}

// 3. Over-unit quaternion (float32 rounding can push b²+c²+d² just past 1). Per
//    nifti1.h it must be renormalized (a=0), not clamped — otherwise the rotation
//    block is non-orthonormal. Verify the columns are unit length after dividing
//    out the voxel size, and the rotation determinant is ±1.
{
  const vox = 2
  const rows = qformAffineRows(header({ b: 0.58, c: 0.58, d: 0.58, vox }))
  assert.ok(rows, 'over-unit: rows returned')
  for (let c = 0; c < 3; c++)
    near(colNorm(rows, c, vox), 1, `over-unit column ${c} orthonormal`)
  // determinant of the unit-scaled rotation should be +1 (qfac=1)
  const r = rows.map((row) => row.slice(0, 3).map((v) => v / vox))
  const det =
    r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
    r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
    r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0])
  near(det, 1, 'over-unit rotation det = +1')
}

// 4. No qform (qform_code <= 0) → null, which drives the tracker's pixdim
//    fallback in readAffine.
{
  const dv = header({ d: 1 })
  dv.setInt16(252, 0, LE)
  assert.equal(qformAffineRows(dv), null, 'no qform → null')
}

// --- readAffine selection order: sform preferred → qform → pixdim diagonal ---

// sform present → srow verbatim, even when a qform also exists.
{
  const dv = header({ d: 1 }) // qform_code already 1
  dv.setInt16(254, 1, LE) // sform_code
  const srow = [
    [-2, 0, 0, 90],
    [0, 2, 0, -120],
    [0, 0, 2, -70],
  ]
  const bases = [280, 296, 312]
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) dv.setFloat32(bases[r] + c * 4, srow[r][c], LE)
  const a = readAffine(dv)
  near(a[0][0], -2, 'sform srow_x[0]')
  near(a[0][3], 90, 'sform srow_x[3]')
  near(a[2][2], 2, 'sform srow_z[2]')
}

// no sform but a valid qform → quaternion affine.
{
  const a = readAffine(header({ d: 1 })) // qform_code 1, sform_code 0, 1.8 mm
  near(a[0][0], -1.8, 'qform fallback srow_x[0]')
  near(a[1][1], -1.8, 'qform fallback srow_y[1]')
  near(a[2][2], 1.8, 'qform fallback srow_z[2]')
}

// neither form → pixdim-scaled diagonal at the origin.
{
  const dv = header({})
  dv.setInt16(252, 0, LE)
  for (const o of [80, 84, 88]) dv.setFloat32(o, 2.5, LE)
  const a = readAffine(dv)
  near(a[0][0], 2.5, 'pixdim diag x')
  near(a[2][2], 2.5, 'pixdim diag z')
  near(a[0][3], 0, 'pixdim origin x')
}

// det3: RAS diagonal is positive (neurological storage); LAS is negative.
assert.equal(det3([[2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0]]), 8)
assert.equal(det3([[-2, 0, 0, 0], [0, 2, 0, 0], [0, 0, 2, 0]]), -8)

console.log('nifti-geometry.test: OK')
