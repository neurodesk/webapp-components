/**
 * Golden checks for the pure DVS generator. No framework — run with:
 *   node --experimental-strip-types src/dwi2trx/genvectors.test.ts
 */

import assert from 'node:assert/strict'
import {
  calcPairWeights,
  findPolarityBalanceWarnings,
  generateScheme,
  measureScheme,
  normalizeShells,
  optimizeDirections,
  optimizeIncrementalDirections,
  orderForDutyCycle,
  polarityBalanceWarningThreshold,
  schemeBaseName,
  schemeToDvs,
  schemeToGeDat,
  schemeToPhilipsTxt,
  sqrtRuleCount,
  suggestNextShell,
} from './genvectors.ts'

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`)

const minSeparation = (set: ReturnType<typeof optimizeDirections>): number => {
  let min = Math.PI
  for (let i = 0; i < set.length; i++) {
    for (let j = i + 1; j < set.length; j++) {
      const dot = Math.abs(
        set[i].x * set[j].x + set[i].y * set[j].y + set[i].z * set[j].z,
      )
      min = Math.min(min, Math.acos(Math.min(1, dot)))
    }
  }
  return min
}

// --- Philips TXT: unit directions, explicit b-values, no header, CRLF EOL ---
{
  const s = generateScheme(
    [
      { count: 6, bval: 1500 },
      { count: 6, bval: 3000 },
    ],
    { iters: 20, b0Every: 3 },
  )
  const txt = schemeToPhilipsTxt(s)
  assert.ok(txt.endsWith('\r\n'))
  assert.ok(!txt.replaceAll('\r\n', '').includes('\n'))
  assert.ok(!txt.includes('#'))
  const lines = txt.split('\r\n').filter(Boolean)
  assert.equal(lines.length, s.dirs.length)
  assert.equal(lines[0], '1.000000   0.000000   0.000000   0')
  const b0Directions = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    const columns = lines[i].trim().split(/\s+/).map(Number)
    assert.equal(columns.length, 4)
    approx(Math.hypot(columns[0], columns[1], columns[2]), 1, 1e-5)
    assert.equal(columns[3], s.dirs[i].bval)
    if (columns[3] === 0) b0Directions.add(columns.slice(0, 3).join(','))
  }
  assert.equal(b0Directions.size, s.dirs.filter((d) => d.bval === 0).length)

  assert.throws(
    () => schemeToPhilipsTxt({ ...s, dirs: s.dirs.slice(1) }),
    /must start with a b=0/,
  )
}

// Runtime inputs can come from DOM values or JS callers despite TypeScript types.
// Reject non-finite controls before they silently produce random/empty results.
{
  assert.throws(
    () => generateScheme([{ count: 6, bval: 1000 }], { alpha: Number.NaN }),
    /Alpha must be finite/,
  )
  assert.throws(
    () => generateScheme([{ count: 6, bval: 1000 }], { iters: Infinity }),
    /Iteration limit must be finite/,
  )
  assert.throws(
    () =>
      generateScheme([{ count: 6, bval: 1000 }], {
        method: 'bogus' as never,
      }),
    /Unknown generation method/,
  )
  assert.throws(
    () => optimizeDirections([{ count: 6.5, bval: 1000 }]),
    /positive safe integers/,
  )

  const repeatedB0 = generateScheme([{ count: 6, bval: 1000 }], {
    b0Every: 2,
  })
  const b0s = repeatedB0.dirs.filter((d) => d.bval === 0)
  assert.ok(b0s.length > 1)
  assert.notEqual(b0s[0], b0s[1])

  const invalidDvs = structuredClone(repeatedB0)
  invalidDvs.dirs[1].x = Number.NaN
  assert.throws(() => schemeToDvs(invalidDvs), /only finite numbers/)
}

// --- optimization diagnostics distinguish convergence from ceiling exhaustion ---
{
  const converged = generateScheme([{ count: 6, bval: 1000 }])
  assert.equal(converged.optimization.method, 'simultaneous')
  assert.equal(converged.optimization.stopReason, 'converged')
  assert.equal(converged.optimization.converged, true)
  assert.ok(converged.optimization.iterationsUsed < 1000)
  assert.ok(converged.optimization.finalMaxDisplacement < 1e-7)

  const limited = generateScheme([{ count: 6, bval: 1000 }], { iters: 1 })
  assert.equal(limited.optimization.stopReason, 'max_iterations')
  assert.equal(limited.optimization.converged, false)
  assert.equal(limited.optimization.iterationsUsed, 1)
  assert.ok(limited.optimization.finalMaxDisplacement > 0)
}

// --- polarity-balance warnings use a direction-count-aware threshold ---
{
  approx(polarityBalanceWarningThreshold(6), 0.25)
  approx(polarityBalanceWarningThreshold(30), 0.05)
  const metrics = measureScheme(generateScheme([{ count: 24, bval: 1000 }]))
  assert.deepEqual(findPolarityBalanceWarnings(metrics), [])
  metrics.shells[0].mean.norm = 0.1
  assert.deepEqual(findPolarityBalanceWarnings(metrics), [
    {
      bval: 1000,
      directions: 24,
      meanNorm: 0.1,
      warningThreshold: 1.5 / 24,
    },
  ])
}

// --- final polarity pass balances each shell for whole-sphere Eddy sampling ---
{
  const scheme = generateScheme([
    { count: 24, bval: 1000 },
    { count: 33, bval: 2000 },
  ])
  const metrics = measureScheme(scheme)
  assert.equal(metrics.shells.length, 2)
  for (const shell of metrics.shells) {
    // Report all three component means in a failure, matching the browser QC.
    assert.ok(
      shell.mean.norm < 0.04,
      `b=${shell.bval} polarity mean ` +
        `(${shell.mean.x}, ${shell.mean.y}, ${shell.mean.z}), ` +
        `norm=${shell.mean.norm}`,
    )
    assert.ok(shell.minAxisSeparationDeg > 20)
  }
}

// --- Caruyer web-tool mode is deterministic, incremental, and ignores alpha ---
{
  const shells = [
    { count: 6, bval: 1000 },
    { count: 8, bval: 2000 },
  ]
  const low = optimizeIncrementalDirections(shells, { alpha: 0 })
  const high = optimizeIncrementalDirections(shells, { alpha: 1 })
  assert.deepEqual(low, high)
  assert.equal(low.filter((d) => d.bval === 1000).length, 6)
  assert.equal(low.filter((d) => d.bval === 2000).length, 8)
  // Largest proportional deficit spreads the small shell through the sequence.
  const lowShellIndices = low.flatMap((d, i) => (d.bval === 1000 ? [i] : []))
  assert.ok(lowShellIndices.some((i) => i < low.length / 2))
  assert.ok(lowShellIndices.some((i) => i >= low.length / 2))
  // Every six-direction prefix remains useful, though unlike simultaneous
  // optimization it does not sacrifice prefix quality for the final optimum.
  assert.ok(minSeparation(low.slice(0, 6)) > (30 * Math.PI) / 180)
}

// --- generateScheme preserves incremental shell pacing and direction set ---
{
  const shells = [
    { count: 6, bval: 1000 },
    { count: 8, bval: 2000 },
  ]
  const raw = optimizeIncrementalDirections(shells)
  const scheme = generateScheme(shells, { method: 'incremental' })
  assert.equal(scheme.method, 'incremental')
  const saved = scheme.dirs.slice(1)
  assert.deepEqual(
    saved.map((d) => d.bval),
    raw.map((d) => d.bval),
  )
  assert.ok(minSeparation(saved.slice(0, 6)) > (30 * Math.PI) / 180)
  assert.match(schemeToDvs(scheme), /Incremental construction order preserved/)
  assert.doesNotMatch(schemeToDvs(scheme), /Duty-cycle-balanced/)
  const diagonal = 1 / Math.sqrt(3)
  approx(saved[0].x, diagonal)
  approx(saved[0].y, diagonal)
  approx(saved[0].z, diagonal)
  // Polarity flips and rigid orientation preserve axis separation at each index.
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const dot = (dirs: typeof raw) =>
        Math.abs(
          dirs[i].x * dirs[j].x + dirs[i].y * dirs[j].y + dirs[i].z * dirs[j].z,
        )
      approx(dot(saved), dot(raw), 1e-12)
    }
  }
}

// --- duty-cycle ordering alternates dominant coil axes without changing set ---
{
  const axis = (x: number, y: number, z: number) => ({
    x,
    y,
    z,
    bval: 1000,
  })
  const clustered = [
    axis(1, 0, 0),
    axis(1, 0, 0),
    axis(0, 1, 0),
    axis(0, 1, 0),
    axis(0, 0, 1),
    axis(0, 0, 1),
  ]
  const ordered = orderForDutyCycle(clustered, 1000)
  assert.deepEqual(ordered[0], clustered[0])
  assert.notDeepEqual(ordered[1], clustered[1])
  assert.deepEqual(
    ordered.map((d) => `${d.x},${d.y},${d.z}`).sort(),
    clustered.map((d) => `${d.x},${d.y},${d.z}`).sort(),
  )
}

// --- calcPairWeights exactly matches multishell.py::calc_weights off-diagonal ---
{
  const w = calcPairWeights(
    [
      { count: 12, bval: 1000 },
      { count: 18, bval: 2000 },
    ],
    0.75,
  )
  approx(w.intra[0], 0.75 / (2 * 12 ** 2), 1e-15)
  approx(w.intra[1], 0.75 / (2 * 18 ** 2), 1e-15)
  // Python visits both (s,t) and (t,s), adding each cross matrix entry twice.
  approx(w.cross, (2 * 0.25) / 30 ** 2, 1e-15)
}

// --- optimizeDirections: right count, unit length, deterministic ---
{
  const a = optimizeDirections([{ count: 20, bval: 1000 }], { iters: 50 })
  assert.equal(a.length, 20)
  for (const d of a) approx(Math.hypot(d.x, d.y, d.z), 1, 1e-6)
  // Same seed ⇒ identical output.
  const b = optimizeDirections([{ count: 20, bval: 1000 }], { iters: 50 })
  assert.deepEqual(a, b)
  // Different seed ⇒ different layout.
  const c = optimizeDirections([{ count: 20, bval: 1000 }], {
    iters: 50,
    seed: 7,
  })
  assert.notDeepEqual(a, c)
}

// --- relaxation actually spreads points: min pairwise angle beats random ---
{
  const dirs = optimizeDirections([{ count: 30, bval: 1000 }], { iters: 300 })
  // Minimum angular separation (antipodal-aware) should be comfortably large.
  const minAng = minSeparation(dirs)
  // 30 antipodal directions on a hemisphere pack to ~20°+; assert a safe floor.
  assert.ok(
    minAng > (15 * Math.PI) / 180,
    `min separation ${(minAng * 180) / Math.PI}° too small`,
  )
}

// --- one shell: positive alpha only scales the objective, so positions match ---
{
  const shells = [{ count: 30, bval: 1000 }]
  const low = optimizeDirections(shells, { alpha: 0.25 })
  const high = optimizeDirections(shells, { alpha: 1 })
  assert.deepEqual(low, high)
  // At alpha=0 Python's one-shell weight matrix is identically zero: retain the
  // seeded random initialization rather than pretending alpha has an effect.
  const zero = optimizeDirections(shells, { alpha: 0 })
  assert.notDeepEqual(zero, high)
  assert.ok(minSeparation(zero) < (5 * Math.PI) / 180)
  assert.ok(minSeparation(high) > (20 * Math.PI) / 180)
}

// --- six axes converge to the icosahedral optimum at the default ceiling ---
{
  const dirs = optimizeDirections([{ count: 6, bval: 1000 }])
  // Six unoriented axes are the six antipodal vertex-pairs of an icosahedron:
  // every |dot| = 1/sqrt(5), hence the minimum axis angle is 63.4349488°.
  approx(
    minSeparation(dirs),
    Math.acos(1 / Math.sqrt(5)),
    (0.001 * Math.PI) / 180,
  )
}

// --- multishell alpha trade-off follows the Python reference qualitatively ---
{
  const shells = [
    { count: 30, bval: 1000 },
    { count: 30, bval: 2000 },
  ]
  const crossOnly = optimizeDirections(shells, { alpha: 0 })
  const balanced = optimizeDirections(shells, { alpha: 0.5 })
  const intraOnly = optimizeDirections(shells, { alpha: 1 })
  const shell1 = (dirs: typeof balanced) => dirs.filter((d) => d.bval === 1000)
  // alpha=0 permits same-shell clustering; alpha=1 permits overlap between
  // independently optimized shells; a balanced objective avoids both.
  assert.ok(minSeparation(shell1(crossOnly)) < (1 * Math.PI) / 180)
  assert.ok(minSeparation(intraOnly) < (5 * Math.PI) / 180)
  assert.ok(minSeparation(balanced) > (15 * Math.PI) / 180)
}

// --- unequal shells exercise per-shell and combined-shell force weights ---
{
  const dirs = optimizeDirections([
    { count: 12, bval: 1000 },
    { count: 18, bval: 2000 },
  ])
  assert.ok(minSeparation(dirs) > (15 * Math.PI) / 180)
  assert.ok(
    minSeparation(dirs.filter((d) => d.bval === 1000)) > (25 * Math.PI) / 180,
  )
  assert.ok(
    minSeparation(dirs.filter((d) => d.bval === 2000)) > (25 * Math.PI) / 180,
  )
}

// --- generateScheme: leading b0, interleaved shells, correct total ---
{
  const s = generateScheme(
    [
      { count: 6, bval: 1000 },
      { count: 6, bval: 2000 },
    ],
    { iters: 50 },
  )
  assert.equal(s.maxBval, 2000)
  // 12 directions + 1 leading b0.
  assert.equal(s.dirs.length, 13)
  assert.equal(s.dirs[0].bval, 0) // leading b0 at origin
  approx(s.dirs[0].x, 0)
  // The first saved direction is equally oblique to all scanner axes.
  const diagonal = 1 / Math.sqrt(3)
  approx(s.dirs[1].x, diagonal)
  approx(s.dirs[1].y, diagonal)
  approx(s.dirs[1].z, diagonal)
  // First two diffusion samples come from different shells (interleaved).
  assert.notEqual(s.dirs[1].bval, s.dirs[2].bval)
  // Counts per shell preserved.
  assert.equal(s.dirs.filter((d) => d.bval === 1000).length, 6)
  assert.equal(s.dirs.filter((d) => d.bval === 2000).length, 6)
}

// --- b0Every inserts interspersed b0s ---
{
  const s = generateScheme([{ count: 8, bval: 1000 }], {
    iters: 20,
    b0Every: 4,
  })
  // leading b0 + 8 dirs + a b0 before dir 5 (index 4) = 10.
  assert.equal(s.dirs.length, 10)
  assert.equal(s.dirs.filter((d) => d.bval === 0).length, 2)
}

// --- DVS: header + √(b/bmax) scaling + b0 line ---
{
  const s = generateScheme(
    [
      { count: 6, bval: 1000 },
      { count: 6, bval: 4000 },
    ],
    { iters: 40 },
  )
  const dvs = schemeToDvs(s)
  assert.match(dvs, /\[directions=13\]/) // 12 + leading b0
  assert.match(dvs, /coordinatesystem=xyz/)
  assert.match(dvs, /normalisation = none/)
  assert.match(dvs, /Vector\[0\] {2}= \(0\.000000, 0\.000000, 0\.000000\)/)
  // A b=1000 vector against bmax 4000 has length √(1/4) = 0.5.
  const b1000 = s.dirs.find((d) => d.bval === 1000)
  const len = Math.sqrt(1000 / 4000)
  approx(len, 0.5)
  // Every non-b0 line's parsed length equals √(bval/bmax) for its shell.
  const lines = dvs.split('\n').filter((l) => /^Vector\[/.test(l))
  assert.equal(lines.length, 13)
  for (let i = 0; i < s.dirs.length; i++) {
    const m = lines[i].match(/\(([^,]+), ([^,]+), ([^)]+)\)/)
    assert.ok(m)
    const vlen = Math.hypot(Number(m[1]), Number(m[2]), Number(m[3]))
    const expect = s.dirs[i].bval > 0 ? Math.sqrt(s.dirs[i].bval / 4000) : 0
    approx(vlen, expect, 1e-5)
  }
  assert.ok(b1000)
}

// --- GE DAT: comments, count, space-separated scaled vectors, LF-only EOL ---
{
  const s = generateScheme(
    [
      { count: 6, bval: 1000 },
      { count: 6, bval: 2000 },
    ],
    { iters: 20 },
  )
  const dat = schemeToGeDat(s)
  assert.ok(dat.endsWith('\n'))
  assert.ok(!dat.includes('\r'))
  assert.match(dat, /^# Multi-shell tensor file generated by dwi2trx\n/)
  assert.match(dat, /# GE logical coordinates: X=frequency, Y=phase, Z=slice\n/)
  const dataLines = dat
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
  assert.equal(Number(dataLines[0]), s.dirs.length)
  assert.equal(dataLines.length, s.dirs.length + 1)
  for (let i = 0; i < s.dirs.length; i++) {
    assert.match(dataLines[i + 1], /^-?\d+\.\d{6} -?\d+\.\d{6} -?\d+\.\d{6}$/)
    const magnitude = Math.hypot(
      ...(dataLines[i + 1].split(' ').map(Number) as [number, number, number]),
    )
    const expected =
      s.dirs[i].bval > 0 ? Math.sqrt(s.dirs[i].bval / s.maxBval) : 0
    approx(magnitude, expected, 1e-5)
  }
  const bytes = new TextEncoder().encode(dat)
  assert.ok(bytes.includes(0x0a))
  assert.ok(!bytes.includes(0x0d))
  // The scanner selects a table by the console's direction count, so the header
  // must state it (vendor tensorNNNN.dat files carry this line).
  assert.match(
    dat,
    new RegExp(
      `# Diffusion tab: number of directions \\(TENSOR\\): ${s.dirs.length}\\n`,
    ),
  )
}

// --- serialization guards reject schemes no scanner could run ---
{
  const base = generateScheme([{ count: 6, bval: 1000 }], { iters: 20 })
  const throws = (scheme: typeof base, re: RegExp) => {
    assert.throws(
      () => schemeToDvs(scheme),
      (e: unknown) => re.test((e as Error).message),
    )
    assert.throws(
      () => schemeToGeDat(scheme),
      (e: unknown) => re.test((e as Error).message),
    )
    assert.throws(
      () => schemeToPhilipsTxt(scheme),
      (e: unknown) => re.test((e as Error).message),
    )
  }
  // b > maxBval would emit |g| > 1 — impossible on a scanner, forbidden by GE.
  throws(
    { ...base, dirs: [{ x: 1, y: 0, z: 0, bval: 5000 }] },
    /exceed the maximum/,
  )
  throws({ ...base, dirs: [] }, /at least one volume/)
  throws(
    { ...base, dirs: [{ x: Number.NaN, y: 0, z: 0, bval: 1000 }] },
    /finite/,
  )
  assert.throws(
    () =>
      schemeToGeDat({
        ...base,
        dirs: Array.from({ length: 301 }, () => ({ ...base.dirs[1] })),
      }),
    /6–300 volumes/,
  )
}

// --- orderForDutyCycle fails loudly on a non-finite b-value ---
// (a NaN bval used to match no shell, silently splicing off the LAST direction)
assert.throws(
  () =>
    orderForDutyCycle(
      [
        { x: 1, y: 0, z: 0, bval: 1000 },
        { x: 0, y: 1, z: 0, bval: Number.NaN },
        { x: 0, y: 0, z: 1, bval: 1000 },
      ],
      1000,
    ),
  (e: unknown) => /finite/.test((e as Error).message),
)

// --- normalizeShells: round, drop empties, merge duplicate b-values, clone ---
// sorted ascending by b-value
assert.deepEqual(
  normalizeShells([
    { count: 30, bval: 2000 },
    { count: 24, bval: 1000 },
  ]),
  [
    { count: 24, bval: 1000 },
    { count: 30, bval: 2000 },
  ],
)
// Duplicate b-values merge (counts sum).
assert.deepEqual(
  normalizeShells([
    { count: 10, bval: 1000 },
    { count: 15, bval: 1000 },
  ]),
  [{ count: 25, bval: 1000 }],
)
// Fractional counts round; non-positive / non-finite drop.
assert.deepEqual(
  normalizeShells([
    { count: 12.4, bval: 1000 },
    { count: 0, bval: 2000 },
    { count: 5, bval: -1 },
    { count: 5, bval: Number.NaN },
  ]),
  [{ count: 12, bval: 1000 }],
)

// --- generateScheme returns FRESH shells (no aliasing the caller's array) ---
{
  const input = [{ count: 6, bval: 1000 }]
  const s = generateScheme(input, { iters: 20 })
  input[0].count = 999 // mutate the caller's array afterwards
  assert.equal(s.shells[0].count, 6) // scheme unaffected
  assert.notEqual(s.shells[0], input[0]) // distinct object
}

// --- phase-interleaving spreads a small shell across the sequence (no tail) ---
{
  const s = generateScheme(
    [
      { count: 6, bval: 1000 },
      { count: 8, bval: 2000 },
    ],
    { iters: 20 },
  )
  const diff = s.dirs.filter((d) => d.bval > 0) // drop the leading b0
  const half = diff.length / 2
  const lowIdx = diff.flatMap((d, i) => (d.bval === 1000 ? [i] : []))
  // The two b=1000 volumes land on opposite halves — not clustered at the front
  // (round-robin used to leave a 6-long b=2000 tail).
  assert.ok(
    lowIdx.some((i) => i < half) && lowIdx.some((i) => i >= half),
    `b=1000 not spread across halves: ${lowIdx}`,
  )
}

// --- square-root rule: 24@1000 → 33@2000 → 39@3000 → 45@4000 ---
assert.equal(sqrtRuleCount(24, 1000, 2000), 33)
assert.equal(sqrtRuleCount(33, 2000, 3000), 39)
assert.equal(sqrtRuleCount(39, 3000, 4000), 45)
// suggestNextShell compounds off the last shell, bumping b by 1000.
assert.deepEqual(suggestNextShell([{ count: 24, bval: 1000 }]), {
  count: 33,
  bval: 2000,
})
assert.deepEqual(
  suggestNextShell([
    { count: 24, bval: 1000 },
    { count: 33, bval: 2000 },
  ]),
  { count: 39, bval: 3000 },
)
// Degenerate last shell (e.g. cleared b) falls back to a sane default.
assert.deepEqual(suggestNextShell([{ count: 5, bval: 0 }]), {
  count: 24,
  bval: 1000,
})
assert.deepEqual(suggestNextShell([]), { count: 24, bval: 1000 })

// --- schemeBaseName ---
assert.equal(
  schemeBaseName([
    { count: 30, bval: 1000 },
    { count: 30, bval: 2000 },
  ]),
  '30x1000_30x2000',
)

// --- validation errors ---
const throws = (fn: () => void, re: RegExp) =>
  assert.throws(fn, (e: unknown) => re.test((e as Error).message))
throws(() => generateScheme([], {}), /at least one shell/)
throws(
  () => generateScheme([{ count: 0, bval: 1000 }], {}),
  /at least one shell/,
)
throws(() => generateScheme([{ count: 2000, bval: 1000 }], {}), /Too many/)
throws(
  () => generateScheme([{ count: 5, bval: 1000 }], {}),
  /at least 6 directions/,
)

console.log('genvectors.test.ts: all assertions passed ✓')
