/**
 * Golden checks for the pure gradient-scheme builder. No framework — run with:
 *   node --experimental-strip-types src/dwi2trx/vectors.test.ts
 */

import assert from 'node:assert/strict'
import {
  buildGradientScheme,
  buildSchemeFromSamples,
  withAntipodalNodes,
} from './vectors.ts'

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`)

// --- b0 at origin; maximum shell normalized to plotted radius 1 ---
// 2 b0s (collapse to one origin node) + one x-direction + one y-direction.
{
  const bval = '0 0 1000 1000'
  const bvec = '0 0 1 0\n0 0 0 1\n0 0 0 0'
  const s = buildGradientScheme(bval, bvec)
  assert.equal(s.directions, 4)
  assert.equal(s.nodes, 3) // two b0s merged, +x, +y
  assert.equal(s.maxBval, 1000)

  const origin = s.data.nodes.find((n) => n.colorValue === 0)
  assert.ok(origin, 'origin node exists')
  approx(origin.x, 0)
  approx(origin.y, 0)
  approx(origin.z, 0)

  // baseRadius = normalized max/20 = 0.05; two b0s ⇒ radius 0.05 × ∛2.
  approx(origin.sizeValue, 0.05 * Math.cbrt(2))

  // The maximum-shell +x direction sits at radius 1.
  const xnode = s.data.nodes.find((n) => n.x > 0.5)
  assert.ok(xnode)
  approx(xnode.x, 1)
  approx(xnode.sizeValue, 0.05)
  assert.equal(xnode.colorValue, 1000)
}

// --- colour range spans 0..maxBval ---
{
  const s = buildGradientScheme('0 3000', '0 1\n0 0\n0 0')
  assert.equal(s.options.nodeColormap, 'actc')
  assert.equal(s.options.nodeMinColor, 0)
  assert.equal(s.options.nodeMaxColor, 3000)
  assert.equal(s.options.nodeScale, 1)
}

// --- non-unit bvecs are normalized before plotted-length scaling ---
{
  // bvec length 2 along x at the maximum shell still plots at radius 1.
  const s = buildGradientScheme('1000', '2\n0\n0')
  approx(s.data.nodes[0].x, 1)
}

// --- default shell radii reflect gradient amplitude √(b/bmax) ---
{
  const s = buildGradientScheme('1000 2000', '1 0\n0 1\n0 0')
  const low = s.data.nodes.find((node) => node.x > 0)
  const high = s.data.nodes.find((node) => node.y > 0)
  assert.ok(low)
  assert.ok(high)
  approx(low.x, Math.sqrt(0.5))
  approx(high.y, 1)
}

// --- antipodal directions are kept distinct (half- vs whole-sphere matters) ---
{
  const s = buildGradientScheme('1000 1000', '1 -1\n0 0\n0 0')
  assert.equal(s.nodes, 2)
  assert.equal(s.coverage, 'whole sphere')
}

// --- coherent signed directions are identified as half-sphere sampling ---
{
  const s = buildGradientScheme(
    '1000 1000 1000 1000',
    '1 0 0.707 0.707\n0 1 0.707 -0.707\n0 0 0 0',
  )
  assert.equal(s.coverage, 'half sphere')
}

// --- ∛N radius: 8 identical samples ⇒ 2× the single-sample radius ---
{
  const dirs = Array(8).fill('1').join(' ')
  const zeros = Array(8).fill('0').join(' ')
  const s = buildGradientScheme(
    Array(8).fill('1000').join(' '),
    `${dirs}\n${zeros}\n${zeros}`,
  )
  assert.equal(s.nodes, 1)
  approx(s.data.nodes[0].sizeValue, 0.05 * 2)
}

// --- all-b0 acquisition: one node, non-degenerate colour range ---
{
  const s = buildGradientScheme('0 0 0', '0 0 0\n0 0 0\n0 0 0')
  assert.equal(s.nodes, 1)
  assert.equal(s.maxBval, 0)
  assert.equal(s.options.nodeMaxColor, 1) // guarded away from 0
  assert.ok(s.data.nodes[0].sizeValue > 0)
}

// --- shells summary, ascending by b-value ---
{
  const s = buildGradientScheme('0 1000 1000 2500', '0 1 0 1\n0 0 1 0\n0 0 0 0')
  assert.deepEqual(s.shells, [
    [0, 1],
    [1000, 2],
    [2500, 1],
  ])
}

// --- b0 volumes with DIFFERENT (nonzero) bvecs still merge into one node ---
{
  // Converters often emit arbitrary unit bvecs for b0 volumes; all are b0 and
  // must collapse to one node at the origin, not three z-fighting balls.
  const s = buildGradientScheme('0 0 0', '1 0 0\n0 1 0\n0 0 1')
  assert.equal(s.nodes, 1)
  approx(s.data.nodes[0].sizeValue, 1 * Math.cbrt(3)) // all-b0 baseRadius 1 × ∛3
}

// --- near-equal b-values collapse to one shell (acquisition jitter) ---
{
  // 995 and 1005 both snap to the b=1000 shell (SHELL_TOL = 50).
  const s = buildGradientScheme('0 995 1005', '0 1 -1\n0 0 0\n0 0 0')
  assert.deepEqual(s.shells, [
    [0, 1],
    [1000, 2],
  ])
}

// --- buildSchemeFromSamples: structured input, no bval/bvec text round-trip ---
{
  const s = buildSchemeFromSamples([
    { x: 0, y: 0, z: 0, bval: 0 }, // b0
    { x: 1, y: 0, z: 0, bval: 2000 },
    { x: 0, y: 1, z: 0, bval: 2000 },
  ])
  assert.equal(s.directions, 3)
  assert.equal(s.nodes, 3)
  assert.equal(s.maxBval, 2000)
  const xnode = s.data.nodes.find((n) => n.x > 0.5)
  assert.ok(xnode)
  approx(xnode.x, 1)
}

// --- withAntipodalNodes mirrors diffusion nodes (preview-only), not b0 ---
{
  const base = buildSchemeFromSamples([
    { x: 0, y: 0, z: 0, bval: 0 }, // b0 at origin
    { x: 1, y: 0, z: 0, bval: 2000 },
    { x: 0, y: 1, z: 0, bval: 2000 },
  ])
  const mirrored = withAntipodalNodes(base)
  assert.equal(base.data.nodes.length, 3) // original not mutated
  assert.equal(mirrored.data.nodes.length, 5) // + 2 antipodes (b0 not mirrored)
  assert.equal(mirrored.nodes, 5)
  const x2000 = base.data.nodes.find((n) => n.x > 0.5)
  assert.ok(x2000)
  // The mirror sits at the exact antipode with half the radius.
  const anti = mirrored.data.nodes.find((n) => n.x < -0.5)
  assert.ok(anti)
  approx(anti.x, -x2000.x)
  approx(anti.sizeValue, x2000.sizeValue * 0.5)
}

// --- malformed inputs throw caller-facing errors ---
const throws = (fn: () => void, re: RegExp) =>
  assert.throws(fn, (e: unknown) => re.test((e as Error).message))
throws(() => buildGradientScheme('', '0\n0\n0'), /empty/)
throws(() => buildGradientScheme('1000', '0\n0'), /3 rows/)
throws(
  () => buildGradientScheme('1000 2000', '1\n0\n0'),
  /values but bval lists/,
)
throws(() => buildGradientScheme('0 -1000', '0 1\n0 0\n0 0'), /negative/)
throws(
  () => buildGradientScheme('0 1000', '0 0\n0 0\n0 0'),
  /no diffusion direction/,
)

console.log('vectors.test.ts: all assertions passed ✓')
