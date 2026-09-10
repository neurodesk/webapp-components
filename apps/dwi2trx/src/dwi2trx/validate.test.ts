/**
 * Golden checks for the pure validation logic. No framework — run with:
 *   node --experimental-strip-types src/dwi2trx/validate.test.ts
 * (node 25 strips TS types natively). Asserts and exits non-zero on failure.
 */

import assert from 'node:assert/strict'
import {
  baseName,
  chooseBestSeries,
  countDirections,
  flipBvecX,
  isBval,
  isNifti,
  parseNumbers,
} from './validate.ts'

// --- name classifiers + grouping ---
assert.equal(isNifti('dwi.nii.gz'), true)
assert.equal(isNifti('dwi.nii'), true)
assert.equal(isNifti('dwi.bval'), false)
assert.equal(isBval('dwi.bval'), true)
assert.equal(baseName('dwi.nii.gz'), 'dwi')
assert.equal(baseName('sub-01_dwi.bvec'), 'sub-01_dwi')
assert.equal(baseName('series_007.json'), 'series_007')

// --- parseNumbers ---
assert.deepEqual(parseNumbers(' 0  2500\t2500 \n'), [0, 2500, 2500])
assert.deepEqual(parseNumbers(''), [])

// --- countDirections: valid 3-direction case ---
const bval = '0 2500 2500'
const bvec = '0 0.1 0.2\n0 0.3 0.4\n0 0.5 0.6'
assert.equal(countDirections(bval, bvec), 3)

// matches the bundled sample shape (1 b0 + 20 dirs = 21)
const bval21 = `0 ${Array(20).fill(2500).join(' ')}`
const row21 = Array(21).fill(0).join(' ')
assert.equal(countDirections(bval21, `${row21}\n${row21}\n${row21}`), 21)

// --- countDirections: error cases ---
const throws = (fn: () => void, re: RegExp) =>
  assert.throws(
    fn,
    (e: unknown) => re.test((e as Error).message),
    `expected /${re.source}/`,
  )

throws(() => countDirections('', bvec), /empty/)
throws(() => countDirections('a b c', bvec), /non-numeric/)
throws(() => countDirections(bval, '0 0.1 0.2\n0 0.3 0.4'), /3 rows/) // only 2 rows
throws(
  () => countDirections(bval, '0 0.1\n0 0.3\n0 0.5'),
  /values but bval lists/,
) // 2 cols vs 3
throws(() => countDirections(bval, 'x y z\n0 0 0\n0 0 0'), /non-numeric/)
throws(() => countDirections('0 Infinity 2500', bvec), /finite/) // Infinity rejected
throws(() => countDirections('0 -1000 2500', bvec), /negative/)

// --- chooseBestSeries: pick the valid candidate with the most directions ---
// single valid candidate
assert.equal(chooseBestSeries([{ directions: 21, volumes: 21 }]), 0)
// most directions among valid wins
assert.equal(
  chooseBestSeries([
    { directions: 7, volumes: 7 },
    { directions: 33, volumes: 33 },
  ]),
  1,
)
// the largest sidecar count has a broken NIfTI → the valid smaller one is chosen
assert.equal(
  chooseBestSeries([
    { directions: 64, volumes: 1 }, // mismatch (broken NIfTI)
    { directions: 21, volumes: 21 }, // valid
  ]),
  1,
)
// none match → -1
assert.equal(chooseBestSeries([{ directions: 10, volumes: 5 }]), -1)
assert.equal(chooseBestSeries([]), -1)

// flipBvecX negates only the x row and keeps zeros unsigned.
assert.equal(flipBvecX('0 0.5 -1\n0 0.2 0\n1 0.8 0\n'), '0 -0.5 1\n0 0.2 0\n1 0.8 0')

console.log('validate.test.ts: all assertions passed ✓')
