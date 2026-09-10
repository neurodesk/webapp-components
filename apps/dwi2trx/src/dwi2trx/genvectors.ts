/**
 * Generate uniform multi-shell diffusion gradient schemes and serialize them to
 * Siemens DVS files — a browser HEURISTIC inspired by Emmanuel Caruyer's q-space
 * sampling (Caruyer et al., MRM 2013) and Anderson Winkler's `multishell.py`.
 * Two methods (see `GenMethod`), both minimizing the antipodal electrostatic
 * energy v(u,v) = 1/|u−v|² + 1/|u+v|² (each pair repels through BOTH antipodes, so
 * an even number of directions never collapses onto a single axis):
 *
 *   'simultaneous' (Winkler) — `optimizeDirections`: all directions relaxed
 *       together by projected gradient. Pair weights reproduce
 *       `multishell.py::calc_weights` (intra α/(S·K_s²), cross 2(1−α)/K²), so the
 *       cost balances per-shell vs between-shell uniformity as V = α·V₁+(1−α)·V₂;
 *       only the numerical optimizer differs from the paper's SLSQP. α applies.
 *   'incremental' (Caruyer web tool) — `optimizeIncrementalDirections`: add one
 *       direction at a time, earlier ones fixed. Shell selection matches
 *       `multishell.py::next_shell`, but placement is ALPHA-FREE (every prior
 *       direction repels equally) — matching Caruyer's web tool, NOT
 *       multishell.py's α-weighted incremental. Its acquisition order is
 *       preserved so truncated prefixes retain useful angular coverage.
 *
 * Neither is a certified optimum — treat the output as a good starting scheme to
 * VERIFY, not a validated protocol.
 *
 * Pure + DOM/NiiVue-free so it unit-tests in plain node (see genvectors.test.ts).
 * Both optimisers are seeded (deterministic). The DVS scales each vector to
 * |g| = √(b/b_max), the amplitude that produces b-weighting b on a scanner
 * running the max shell.
 */

/** One shell of the acquisition: how many directions, at what b-value. */
export interface ShellSpec {
  count: number
  bval: number
}

/** A single ordered sample: a unit direction + its shell b-value (a b0 is the
 *  zero vector with bval 0). */
export interface GenDir {
  x: number
  y: number
  z: number
  bval: number
}

export interface GenScheme {
  /** Ordered samples, b0s included. */
  dirs: GenDir[]
  /** Largest shell b-value (the DVS unit-length reference). */
  maxBval: number
  shells: ShellSpec[]
  method: GenMethod
  optimization: OptimizationDiagnostics
}

export type GenMethod = 'simultaneous' | 'incremental'

export type OptimizationStopReason =
  | 'converged'
  | 'max_iterations'
  | 'zero_objective'

export interface OptimizationDiagnostics {
  method: GenMethod
  /** Simultaneous iterations, or total one-vector iterations for incremental. */
  iterationsUsed: number
  /** Configured ceiling per simultaneous run / incremental direction. */
  iterationLimit: number
  /** Largest final chord displacement (across directions for incremental). */
  finalMaxDisplacement: number
  converged: boolean
  stopReason: OptimizationStopReason
}

interface OptimizationResult {
  dirs: GenDir[]
  diagnostics: OptimizationDiagnostics
}

export interface GenOptions {
  /** Simultaneous Winkler-compatible or incremental Caruyer-web-tool scheme. */
  method?: GenMethod
  /** Per-shell ↔ combined-shell uniformity weight (0..1, default 0.75). */
  alpha?: number
  /** Maximum relaxation iterations (default 1000; may stop early). */
  iters?: number
  /** Stop after stable iterations move every vector by less than this chord
   *  distance (default 1e-7; 0 disables early stopping). */
  convergenceTolerance?: number
  /** Insert a b0 before every N diffusion directions (0 = only a leading b0). */
  b0Every?: number
  /** PRNG seed for the initial layout (deterministic output). */
  seed?: number
}

const DEFAULT_ALPHA = 0.75
const DEFAULT_ITERS = 1000
const DEFAULT_CONVERGENCE_TOLERANCE = 1e-7
const STABLE_ITERATIONS_REQUIRED = 5
const DEFAULT_SEED = 42
// Softening floors that keep the singular 1/|Δ|⁴ repulsion finite when two points
// nearly coincide. Simultaneous caps the tangential force magnitude before it
// steps (so a coarse floor is enough); the incremental line search compares raw
// energies, so it uses a tighter floor to keep near-coincident placements ordered.
const SOFTENING_SIM = 1e-4
const SOFTENING_INCR = 1e-9
// Guardrail: the optimiser is O(N²) per iteration. The UI runs it in a Web
// Worker, but this cap still bounds latency and memory for accidental inputs.
export const MAX_TOTAL_DIRECTIONS = 1000
export const MIN_DIRECTIONS_PER_SHELL = 6
/** GE custom tensor tables document 6–300 rows per direction-count block. */
export const GE_DAT_MIN_DIRECTIONS = 6
export const GE_DAT_MAX_DIRECTIONS = 300

function finiteOption(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const result = value ?? fallback
  if (!Number.isFinite(result)) throw new Error(`${name} must be finite.`)
  return result
}

function validateOptimizerShells(shells: ShellSpec[]): void {
  if (shells.length === 0) throw new Error('At least one shell is required.')
  let total = 0
  for (const shell of shells) {
    if (!Number.isSafeInteger(shell.count) || shell.count <= 0)
      throw new Error('Shell counts must be positive safe integers.')
    if (!Number.isFinite(shell.bval) || shell.bval <= 0)
      throw new Error('Shell b-values must be positive and finite.')
    total += shell.count
  }
  if (total > MAX_TOTAL_DIRECTIONS)
    throw new Error(
      `Too many directions (${total}). Keep the total under ${MAX_TOTAL_DIRECTIONS}.`,
    )
}

export interface PairWeights {
  /** Raw weight for a pair whose members are both in shell s. */
  intra: number[]
  /** Raw weight for a pair whose members are in different shells. */
  cross: number
}

/**
 * Reproduce the off-diagonal entries made by `multishell.py::calc_weights`.
 * The Python nested shell loop adds each cross-shell matrix entry twice, hence
 * `2(1−α)/K²`. Keeping this small function public makes parity directly
 * testable without allocating Python's K×K matrix.
 */
export function calcPairWeights(
  shells: ShellSpec[],
  alphaValue: number,
): PairWeights {
  if (!Number.isFinite(alphaValue)) throw new Error('Alpha must be finite.')
  const alpha = clamp(alphaValue, 0, 1)
  const n = shells.reduce((sum, shell) => sum + shell.count, 0)
  const shellCount = shells.length
  return {
    intra: shells.map((shell) =>
      shellCount > 0 && shell.count > 0
        ? alpha / (shellCount * shell.count * shell.count)
        : 0,
    ),
    cross: n > 0 ? (2 * (1 - alpha)) / (n * n) : 0,
  }
}

/** Deterministic PRNG (mulberry32) so a scheme is reproducible from its inputs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A random point on the unit sphere (three Gaussians, normalized). */
function randUnit(rng: () => number): [number, number, number] {
  // Box–Muller for two standard normals; a third from a second draw.
  const g = () => {
    const u = Math.max(rng(), 1e-12)
    const v = rng()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  let x = g()
  let y = g()
  let z = g()
  let n = Math.hypot(x, y, z)
  if (n < 1e-9) {
    x = 1
    y = 0
    z = 0
    n = 1
  }
  return [x / n, y / n, z / n]
}

/**
 * Relax `shells` worth of directions on the sphere and return them as unit
 * vectors tagged with their shell b-value (no b0s, source order). Exposed for
 * testing; `generateScheme` wraps it with ordering + b0 insertion.
 *
 * A projected-gradient relaxation, NOT the exact SLSQP optimizer from the Python
 * reference. Pair weights have the same ratios as `multishell.py::calc_weights`:
 * α/(S K_s²) within shell s and 2(1−α)/K² between shells. A single common
 * scale factor keeps the browser relaxation numerically well-conditioned and
 * cannot change the minimizer. Pairs are visited once and the equal/antipodal
 * forces applied to both endpoints (halving the inner loop).
 */
export function optimizeDirections(
  shells: ShellSpec[],
  opts: GenOptions = {},
): GenDir[] {
  return optimizeDirectionsDetailed(shells, opts).dirs
}

function optimizeDirectionsDetailed(
  shells: ShellSpec[],
  opts: GenOptions = {},
): OptimizationResult {
  validateOptimizerShells(shells)
  const alpha = clamp(finiteOption(opts.alpha, DEFAULT_ALPHA, 'Alpha'), 0, 1)
  const iters = Math.max(
    1,
    Math.round(finiteOption(opts.iters, DEFAULT_ITERS, 'Iteration limit')),
  )
  const convergenceTolerance = Math.max(
    0,
    finiteOption(
      opts.convergenceTolerance,
      DEFAULT_CONVERGENCE_TOLERANCE,
      'Convergence tolerance',
    ),
  )
  const rng = mulberry32(finiteOption(opts.seed, DEFAULT_SEED, 'Seed'))

  const px: number[] = []
  const py: number[] = []
  const pz: number[] = []
  const shellOf: number[] = []
  shells.forEach((sh, si) => {
    for (let k = 0; k < sh.count; k++) {
      const [x, y, z] = randUnit(rng)
      px.push(x)
      py.push(y)
      pz.push(z)
      shellOf.push(si)
    }
  })
  const n = px.length

  // Faithful to multishell.py::calc_weights. Its nested (s,t) loop adds every
  // cross-shell matrix entry twice, hence the factor 2 in crossRaw. The Python
  // cost also visits both W[i,j] and W[j,i], but that doubles every unordered
  // pair equally and therefore does not affect the minimizer.
  const { intra: intraRaw, cross: crossRaw } = calcPairWeights(shells, alpha)

  // Absolute objective scale is irrelevant to its optimum. Normalize the
  // largest total incident weight to one so the existing relaxation step has a
  // stable meaning across direction counts, shell sizes, and alpha values.
  let maxIncident = 0
  for (let si = 0; si < shells.length; si++) {
    const ks = shells[si].count
    maxIncident = Math.max(
      maxIncident,
      intraRaw[si] * Math.max(0, ks - 1) + crossRaw * Math.max(0, n - ks),
    )
  }
  const weightScale = maxIncident > 0 ? 1 / maxIncident : 0
  const crossW = crossRaw * weightScale
  const intraW = intraRaw.map((w) => w * weightScale)

  if (weightScale === 0) {
    return {
      dirs: px.map((x, i) => ({
        x,
        y: py[i],
        z: pz[i],
        bval: shells[shellOf[i]].bval,
      })),
      diagnostics: {
        method: 'simultaneous',
        iterationsUsed: 0,
        iterationLimit: iters,
        finalMaxDisplacement: 0,
        converged: true,
        stopReason: 'zero_objective',
      },
    }
  }

  const fx = new Float64Array(n)
  const fy = new Float64Array(n)
  const fz = new Float64Array(n)
  let stableIterations = 0
  let iterationsUsed = 0
  let finalMaxDisplacement = 0
  let converged = false

  for (let it = 0; it < iters; it++) {
    iterationsUsed = it + 1
    // Anneal the step so early chaos settles into a smooth final packing.
    const lr = 0.05 * (1 - it / iters) + 0.002
    fx.fill(0)
    fy.fill(0)
    fz.fill(0)
    // Visit each unordered pair once; accumulate forces on both endpoints.
    let maxDisplacement = 0
    for (let i = 0; i < n; i++) {
      const uix = px[i]
      const uiy = py[i]
      const uiz = pz[i]
      const si = shellOf[i]
      for (let j = i + 1; j < n; j++) {
        const w = si === shellOf[j] ? intraW[si] : crossW
        if (w === 0) continue
        // Direct term 2(u−v)/|u−v|⁴: equal and opposite on the two endpoints.
        const dx = uix - px[j]
        const dy = uiy - py[j]
        const dz = uiz - pz[j]
        let d2 = dx * dx + dy * dy + dz * dz
        if (d2 < SOFTENING_SIM) d2 = SOFTENING_SIM
        const a = (2 * w) / (d2 * d2)
        fx[i] += dx * a
        fy[i] += dy * a
        fz[i] += dz * a
        fx[j] -= dx * a
        fy[j] -= dy * a
        fz[j] -= dz * a
        // Antipodal term 2(u+v)/|u+v|⁴: SAME direction on both endpoints (the
        // gradient of 1/|u+v|² w.r.t. u and w.r.t. v is identical).
        const ex = uix + px[j]
        const ey = uiy + py[j]
        const ez = uiz + pz[j]
        let e2 = ex * ex + ey * ey + ez * ez
        if (e2 < SOFTENING_SIM) e2 = SOFTENING_SIM
        const b = (2 * w) / (e2 * e2)
        fx[i] += ex * b
        fy[i] += ey * b
        fz[i] += ez * b
        fx[j] += ex * b
        fy[j] += ey * b
        fz[j] += ez * b
      }
    }
    for (let i = 0; i < n; i++) {
      // Keep the force tangent to the sphere at u, then cap its magnitude so a
      // near-collision can't fling a point across the sphere (step ≤ lr).
      const dot = fx[i] * px[i] + fy[i] * py[i] + fz[i] * pz[i]
      const tx = fx[i] - dot * px[i]
      const ty = fy[i] - dot * py[i]
      const tz = fz[i] - dot * pz[i]
      const mag = Math.hypot(tx, ty, tz)
      const s = mag > 1 ? 1 / mag : 1
      const x = px[i] + lr * tx * s
      const y = py[i] + lr * ty * s
      const z = pz[i] + lr * tz * s
      const nn = Math.hypot(x, y, z) || 1
      const nx = x / nn
      const ny = y / nn
      const nz = z / nn
      maxDisplacement = Math.max(
        maxDisplacement,
        Math.hypot(nx - px[i], ny - py[i], nz - pz[i]),
      )
      px[i] = nx
      py[i] = ny
      pz[i] = nz
    }
    finalMaxDisplacement = maxDisplacement

    // A single tiny step can occur transiently, so require several consecutive
    // stable iterations. Chord displacement is monotonic with angular movement
    // on the unit sphere and avoids an expensive acos for every vector.
    if (convergenceTolerance > 0 && maxDisplacement < convergenceTolerance) {
      stableIterations++
      if (stableIterations >= STABLE_ITERATIONS_REQUIRED) {
        converged = true
        break
      }
    } else {
      stableIterations = 0
    }
  }

  const out: GenDir[] = []
  for (let i = 0; i < n; i++) {
    out.push({ x: px[i], y: py[i], z: pz[i], bval: shells[shellOf[i]].bval })
  }
  return {
    dirs: out,
    diagnostics: {
      method: 'simultaneous',
      iterationsUsed,
      iterationLimit: iters,
      finalMaxDisplacement,
      converged,
      stopReason: converged ? 'converged' : 'max_iterations',
    },
  }
}

/**
 * Incremental sampling used by Caruyer's web tool: add one direction at a time,
 * keep every earlier direction fixed, and place the new direction at the lowest
 * antipodal electrostatic energy found from a seeded random start. The web tool
 * has no alpha control; every earlier direction contributes equally.
 *
 * Shells are selected by their largest proportional deficit, following the
 * incremental construction described by Caruyer et al. and implemented in
 * `multishell.py::next_shell`. Returned order is acquisition order, so every
 * prefix retains the incremental method's useful angular coverage.
 */
export function optimizeIncrementalDirections(
  shells: ShellSpec[],
  opts: GenOptions = {},
): GenDir[] {
  return optimizeIncrementalDirectionsDetailed(shells, opts).dirs
}

function optimizeIncrementalDirectionsDetailed(
  shells: ShellSpec[],
  opts: GenOptions = {},
): OptimizationResult {
  validateOptimizerShells(shells)
  const maxIterations = Math.max(
    1,
    Math.round(finiteOption(opts.iters, DEFAULT_ITERS, 'Iteration limit')),
  )
  const tolerance = Math.max(
    0,
    finiteOption(
      opts.convergenceTolerance,
      DEFAULT_CONVERGENCE_TOLERANCE,
      'Convergence tolerance',
    ),
  )
  const rng = mulberry32(finiteOption(opts.seed, DEFAULT_SEED, 'Seed'))
  const total = shells.reduce((sum, shell) => sum + shell.count, 0)
  const placedPerShell = shells.map(() => 0)
  const out: GenDir[] = []
  let iterationsUsed = 0
  let finalMaxDisplacement = 0
  let hitIterationLimit = false

  const nextShell = (): number => {
    const placed = out.length
    let bestShell = 0
    let bestDeficit = -Infinity
    for (let si = 0; si < shells.length; si++) {
      const targetProportion = shells[si].count / total
      const currentProportion = placed > 0 ? placedPerShell[si] / placed : 0
      const deficit = targetProportion - currentProportion
      if (deficit > bestDeficit) {
        bestDeficit = deficit
        bestShell = si
      }
    }
    return bestShell
  }

  const energy = (x: number, y: number, z: number): number => {
    let value = 0
    for (const v of out) {
      const dx = x - v.x
      const dy = y - v.y
      const dz = z - v.z
      const ex = x + v.x
      const ey = y + v.y
      const ez = z + v.z
      value +=
        1 / Math.max(SOFTENING_INCR, dx * dx + dy * dy + dz * dz) +
        1 / Math.max(SOFTENING_INCR, ex * ex + ey * ey + ez * ez)
    }
    return value
  }

  while (out.length < total) {
    const si = nextShell()
    let [x, y, z] = randUnit(rng)

    if (out.length > 0) {
      let currentEnergy = energy(x, y, z)
      let angularStep = 0.25
      let stableIterations = 0
      let lastDisplacement = 0
      let directionConverged = false
      for (let it = 0; it < maxIterations; it++) {
        iterationsUsed++
        let fx = 0
        let fy = 0
        let fz = 0
        for (const v of out) {
          const dx = x - v.x
          const dy = y - v.y
          const dz = z - v.z
          const d2 = Math.max(SOFTENING_INCR, dx * dx + dy * dy + dz * dz)
          const direct = 2 / (d2 * d2)
          fx += dx * direct
          fy += dy * direct
          fz += dz * direct

          const ex = x + v.x
          const ey = y + v.y
          const ez = z + v.z
          const e2 = Math.max(SOFTENING_INCR, ex * ex + ey * ey + ez * ez)
          const antipodal = 2 / (e2 * e2)
          fx += ex * antipodal
          fy += ey * antipodal
          fz += ez * antipodal
        }

        const radial = fx * x + fy * y + fz * z
        const tx = fx - radial * x
        const ty = fy - radial * y
        const tz = fz - radial * z
        const tangentNorm = Math.hypot(tx, ty, tz)
        if (tangentNorm < 1e-12) {
          directionConverged = true
          lastDisplacement = 0
          break
        }

        // Move along a great circle in the negative-gradient direction. A small
        // backtracking line search replaces SciPy L-BFGS-B in the browser.
        const c = Math.cos(angularStep)
        const s = Math.sin(angularStep) / tangentNorm
        const nx = c * x + s * tx
        const ny = c * y + s * ty
        const nz = c * z + s * tz
        const nextEnergy = energy(nx, ny, nz)
        if (nextEnergy < currentEnergy) {
          const displacement = 2 * Math.sin(angularStep / 2)
          lastDisplacement = displacement
          x = nx
          y = ny
          z = nz
          currentEnergy = nextEnergy
          angularStep = Math.min(0.35, angularStep * 1.2)
          if (tolerance > 0 && displacement < tolerance) {
            stableIterations++
            if (stableIterations >= STABLE_ITERATIONS_REQUIRED) {
              directionConverged = true
              break
            }
          } else {
            stableIterations = 0
          }
        } else {
          angularStep *= 0.5
          stableIterations = 0
          if (angularStep < Math.max(tolerance, 1e-12)) {
            directionConverged = true
            lastDisplacement = angularStep
            break
          }
        }
      }
      finalMaxDisplacement = Math.max(finalMaxDisplacement, lastDisplacement)
      if (!directionConverged) hitIterationLimit = true
    }

    out.push({ x, y, z, bval: shells[si].bval })
    placedPerShell[si]++
  }
  return {
    dirs: out,
    diagnostics: {
      method: 'incremental',
      iterationsUsed,
      iterationLimit: maxIterations,
      finalMaxDisplacement,
      converged: !hitIterationLimit,
      stopReason: hitIterationLimit ? 'max_iterations' : 'converged',
    },
  }
}

/** Validate + normalize a shell list: round counts/b-values to positive integers,
 *  drop empties, merge shells that share a b-value, and return FRESH objects
 *  (never aliasing the caller's array) sorted ascending by b-value. */
export function normalizeShells(shells: ShellSpec[]): ShellSpec[] {
  const byBval = new Map<number, number>()
  for (const s of shells) {
    const count = Math.round(s.count)
    const bval = Math.round(s.bval)
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(bval)) continue
    if (count <= 0 || bval <= 0) continue
    byBval.set(bval, (byBval.get(bval) ?? 0) + count)
  }
  return [...byBval.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bval, count]) => ({ count, bval }))
}

/** Choose u or -u for every axis so each shell's mean gradient approaches zero.
 * Diffusion sampling is unchanged because the energy is antipodally symmetric;
 * the polarity balance improves whole-sphere acquisition for FSL Eddy. */
export function balancePolarities(dirs: GenDir[]): GenDir[] {
  const balanced = dirs.map((d) => ({ ...d }))
  const shellIndices = new Map<number, number[]>()
  balanced.forEach((d, i) => {
    const indices = shellIndices.get(d.bval) ?? []
    indices.push(i)
    shellIndices.set(d.bval, indices)
  })

  for (const indices of shellIndices.values()) {
    const n = indices.length
    if (n < 2) continue
    let bestSigns: number[] | null = null
    let bestScore = Infinity
    const starts = Math.min(16, n)

    for (let start = 0; start < starts; start++) {
      const order = Array.from({ length: n }, (_, k) => (k + start) % n)
      if (start % 2 === 1) order.reverse()
      const signs = Array<number>(n).fill(1)
      let sx = 0
      let sy = 0
      let sz = 0

      // Greedily add each unoriented axis with the polarity producing the
      // smaller partial vector sum.
      for (const local of order) {
        const d = balanced[indices[local]]
        const dot = sx * d.x + sy * d.y + sz * d.z
        const sign = dot > 0 ? -1 : 1
        signs[local] = sign
        sx += sign * d.x
        sy += sign * d.y
        sz += sign * d.z
      }

      // Coordinate descent: flip any polarity that reduces |sum|². Repeated
      // passes are cheap (at most 16 starts × shell size) and deterministic.
      for (let pass = 0; pass < n; pass++) {
        let changed = false
        for (let local = 0; local < n; local++) {
          const d = balanced[indices[local]]
          const sign = signs[local]
          const delta = 4 - 4 * sign * (sx * d.x + sy * d.y + sz * d.z)
          if (delta < -1e-12) {
            signs[local] = -sign
            sx -= 2 * sign * d.x
            sy -= 2 * sign * d.y
            sz -= 2 * sign * d.z
            changed = true
          }
        }
        if (!changed) break
      }

      // Mean-vector norm is primary. Hemisphere-count imbalance is only a
      // deterministic tie-breaker; equal counts alone do not guarantee Eddy's
      // desired zero component means.
      let hemispherePenalty = 0
      for (const axis of ['x', 'y', 'z'] as const) {
        let positive = 0
        for (let local = 0; local < n; local++) {
          if (signs[local] * balanced[indices[local]][axis] >= 0) positive++
        }
        hemispherePenalty += (2 * positive - n) ** 2
      }
      const score = sx * sx + sy * sy + sz * sz + hemispherePenalty * 1e-12
      if (score < bestScore) {
        bestScore = score
        bestSigns = signs
      }
    }

    if (!bestSigns) continue
    for (let local = 0; local < n; local++) {
      if (bestSigns[local] > 0) continue
      const d = balanced[indices[local]]
      d.x = -d.x
      d.y = -d.y
      d.z = -d.z
    }
  }
  return balanced
}

/** Apply one Rodrigues rotation R = I + [v]ₓ + [v]ₓ²/denom to every direction,
 *  where v = axis·sin(θ) and denom = 1 + cos(θ). A single global rotation, so
 *  norms, pairwise angles, shell coverage, and handedness are all preserved. */
function rotateAll(
  dirs: GenDir[],
  vx: number,
  vy: number,
  vz: number,
  denom: number,
): GenDir[] {
  return dirs.map((d) => {
    const cx = vy * d.z - vz * d.y // v × d
    const cy = vz * d.x - vx * d.z
    const cz = vx * d.y - vy * d.x
    const ccx = vy * cz - vz * cy // v × (v × d)
    const ccy = vz * cx - vx * cz
    const ccz = vx * cy - vy * cx
    return {
      ...d,
      x: d.x + cx + ccx / denom,
      y: d.y + cy + ccy / denom,
      z: d.z + cz + ccz / denom,
    }
  })
}

/** Rotate a completed scheme so its first saved diffusion direction is +X. */
function orientFirstDirectionToX(dirs: GenDir[]): GenDir[] {
  if (dirs.length === 0) return []
  const first = dirs[0]
  const c = clamp(first.x, -1, 1)
  // Rodrigues for the minimal rotation from `first` to +X: v = first × X =
  // (0, z, -y), denom = 1 + c. At -X the cross product vanishes; rotate 180°
  // around +Y instead.
  const rotated =
    c < -1 + 1e-12
      ? dirs.map((d) => ({ ...d, x: -d.x, y: d.y, z: -d.z }))
      : rotateAll(dirs, 0, first.z, -first.y, 1 + c)
  // Remove roundoff from the user-visible anchor itself.
  rotated[0] = { ...rotated[0], x: 1, y: 0, z: 0 }
  return rotated
}

/** Canonical global orientation with the first direction equally oblique to all
 * scanner axes: [1,1,1]/sqrt(3). */
function orientFirstDirectionToDiagonal(dirs: GenDir[]): GenDir[] {
  const xOriented = orientFirstDirectionToX(dirs)
  if (xOriented.length === 0) return xOriented
  const t = 1 / Math.sqrt(3)
  // Fixed Rodrigues rotation from +X to (t,t,t): v = X × target = (0, -t, t).
  const rotated = rotateAll(xOriented, 0, -t, t, 1 + t)
  rotated[0] = { ...rotated[0], x: t, y: t, z: t }
  return rotated
}

/** Deterministically order an already-optimized direction set for scanner duty
 * cycle. Shells are scheduled by proportional deficit, while directions within
 * the selected shell minimize overlap with an exponentially decayed history of
 * squared per-axis gradient demand. Squared demand reflects coil heating:
 * |g|²=b/bmax. The fixed first direction and the direction set are unchanged. */
export function orderForDutyCycle(dirs: GenDir[], maxBval: number): GenDir[] {
  if (dirs.length < 2) return dirs.map((dir) => ({ ...dir }))
  if (!Number.isFinite(maxBval) || maxBval <= 0)
    throw new Error('Maximum b-value must be positive and finite.')

  const remaining = dirs.slice(1).map((dir, index) => ({ dir, index }))
  const totals = new Map<number, number>()
  for (const dir of dirs) totals.set(dir.bval, (totals.get(dir.bval) ?? 0) + 1)
  const placed = new Map<number, number>([[dirs[0].bval, 1]])
  const ordered = [{ ...dirs[0] }]
  const demand = (dir: GenDir): [number, number, number] => {
    const scale2 = dir.bval / maxBval
    return [
      scale2 * dir.x * dir.x,
      scale2 * dir.y * dir.y,
      scale2 * dir.z * dir.z,
    ]
  }
  let recent = demand(dirs[0])

  while (remaining.length > 0) {
    const nextPosition = ordered.length + 1
    let selectedShell = remaining[0].dir.bval
    let largestDeficit = -Infinity
    for (const bval of totals.keys()) {
      if (!remaining.some((candidate) => candidate.dir.bval === bval)) continue
      const expected = (nextPosition * (totals.get(bval) ?? 0)) / dirs.length
      const deficit = expected - (placed.get(bval) ?? 0)
      if (deficit > largestDeficit + 1e-12) {
        largestDeficit = deficit
        selectedShell = bval
      }
    }

    let bestRemainingIndex = -1
    let bestScore = Infinity
    let bestOriginalIndex = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      if (candidate.dir.bval !== selectedShell) continue
      const load = demand(candidate.dir)
      const score =
        recent[0] * load[0] + recent[1] * load[1] + recent[2] * load[2]
      if (
        score < bestScore - 1e-15 ||
        (Math.abs(score - bestScore) <= 1e-15 &&
          candidate.index < bestOriginalIndex)
      ) {
        bestRemainingIndex = i
        bestScore = score
        bestOriginalIndex = candidate.index
      }
    }

    // Public callers may bypass generateScheme's normalized shell inputs.
    if (bestRemainingIndex < 0) {
      throw new Error(
        'Direction b-values must be finite to order by duty cycle.',
      )
    }
    const [chosen] = remaining.splice(bestRemainingIndex, 1)
    ordered.push({ ...chosen.dir })
    placed.set(selectedShell, (placed.get(selectedShell) ?? 0) + 1)
    const load = demand(chosen.dir)
    recent = [
      recent[0] * 0.5 + load[0],
      recent[1] * 0.5 + load[1],
      recent[2] * 0.5 + load[2],
    ]
  }
  return ordered
}

/**
 * Generate a full ordered scheme: relax the directions, mix shells, balance
 * polarity, orient the first direction, optionally duty-cycle-order simultaneous
 * output, and insert b0s.
 *
 * ORDERING TRADE-OFF (the two methods deliberately differ — do not unify):
 * `orderForDutyCycle` schedules by proportional shell deficit and per-axis heat;
 * it does NOT optimize the angular coverage of arbitrary prefixes, so a truncated
 * *simultaneous* scan has no coverage guarantee. That is an acceptable price there
 * (simultaneous optimizes the whole set), but it is fatal for *incremental*, whose
 * only reason to exist is usable prefixes: running the duty sorter over incremental
 * output measured a 6-direction prefix collapsing ~51° → ~17° min separation. Hence
 * incremental keeps construction order and is NOT duty-cycle ordered. If you ever
 * want duty ordering for incremental too, you must first bound how far it may
 * permute, and re-measure prefix separation.
 */
export function generateScheme(
  shells: ShellSpec[],
  opts: GenOptions = {},
): GenScheme {
  const clean = normalizeShells(shells)
  if (clean.length === 0) {
    throw new Error('Add at least one shell with a positive count and b-value.')
  }
  const undersized = clean.find(
    (shell) => shell.count < MIN_DIRECTIONS_PER_SHELL,
  )
  if (undersized) {
    throw new Error(
      `Each shell needs at least ${MIN_DIRECTIONS_PER_SHELL} directions (b=${undersized.bval} has ${undersized.count}).`,
    )
  }
  const total = clean.reduce((s, sh) => s + sh.count, 0)
  if (total > MAX_TOTAL_DIRECTIONS) {
    throw new Error(
      `Too many directions (${total}). Keep the total under ${MAX_TOTAL_DIRECTIONS}.`,
    )
  }

  const method = opts.method ?? 'simultaneous'
  if (method !== 'simultaneous' && method !== 'incremental')
    throw new Error(`Unknown generation method: ${String(method)}.`)
  const optimized =
    method === 'incremental'
      ? optimizeIncrementalDirectionsDetailed(clean, opts)
      : optimizeDirectionsDetailed(clean, opts)
  const relaxed = optimized.dirs

  let interleaved: GenDir[]
  if (method === 'incremental') {
    // Preserve Caruyer's construction order: reordering would discard the mode's
    // defining benefit that truncated prefixes retain useful angular coverage.
    interleaved = relaxed
  } else {
    // Simultaneous output is grouped by shell; interleave it by fractional phase.
    // NOTE this no longer sets the acquisition order — `orderForDutyCycle` below
    // re-schedules shells from scratch by proportional deficit. What survives is
    // (a) which direction lands at index 0 (the anchor `orientFirstDirectionToDiagonal`
    // rotates to the diagonal, and the one seed the duty sorter keeps fixed) and
    // (b) the `candidate.index` tie-break. Keep it for those; don't expect more.
    const byShell: GenDir[][] = clean.map(() => [])
    let idx = 0
    clean.forEach((sh, si) => {
      for (let k = 0; k < sh.count; k++) byShell[si].push(relaxed[idx++])
    })
    const phased: Array<{ dir: GenDir; phase: number }> = []
    for (const shellDirs of byShell) {
      const c = shellDirs.length
      for (let k = 0; k < c; k++) {
        phased.push({ dir: shellDirs[k], phase: (k + 0.5) / c })
      }
    }
    phased.sort((a, b) => a.phase - b.phase)
    interleaved = phased.map((p) => p.dir)
  }

  const oriented = orientFirstDirectionToDiagonal(
    balancePolarities(interleaved),
  )
  const maxBval = Math.max(...clean.map((s) => s.bval))
  const ordered =
    method === 'incremental' ? oriented : orderForDutyCycle(oriented, maxBval)
  const b0Every = Math.max(
    0,
    Math.round(finiteOption(opts.b0Every, 0, 'b0 interval')),
  )
  const makeB0 = (): GenDir => ({ x: 0, y: 0, z: 0, bval: 0 })
  const dirs: GenDir[] = [makeB0()] // always a leading b0
  ordered.forEach((d, i) => {
    if (b0Every > 0 && i > 0 && i % b0Every === 0) dirs.push(makeB0())
    dirs.push(d)
  })

  return {
    dirs,
    maxBval,
    shells: clean,
    method,
    optimization: optimized.diagnostics,
  }
}

/** "24×b=1000, 33×b=2000" — the shell breakdown for captions and DVS headers. */
export function describeShells(shells: ShellSpec[]): string {
  return shells.map((s) => `${s.count}×b=${s.bval}`).join(', ')
}

/** Human label for the optimization method (shared by the UI + DVS header). */
export function methodLabel(method: GenMethod): string {
  return method === 'incremental'
    ? 'Caruyer incremental'
    : 'Winkler simultaneous'
}

/** Number of b0 volumes in a generated scheme. */
export function countB0(scheme: GenScheme): number {
  return scheme.dirs.filter((d) => d.bval <= 0).length
}

export interface ShellMetrics {
  bval: number
  directions: number
  mean: { x: number; y: number; z: number; norm: number }
  hemispheres: {
    x: { positive: number; negative: number }
    y: { positive: number; negative: number }
    z: { positive: number; negative: number }
  }
  minAxisSeparationDeg: number
  minSavedSeparationDeg: number
}

export interface SchemeMetrics {
  combinedMinAxisSeparationDeg: number
  shells: ShellMetrics[]
}

export interface PolarityBalanceWarning {
  bval: number
  directions: number
  meanNorm: number
  warningThreshold: number
}

/** Conservative count-aware QC threshold. Optimally signed shells generally
 * scale substantially better than 1/N; 1.5/N accommodates irreducible small-N
 * cases (including the six-axis icosahedral scheme) without hiding poor balance. */
export function polarityBalanceWarningThreshold(directions: number): number {
  return directions > 0 ? 1.5 / directions : Infinity
}

export function findPolarityBalanceWarnings(
  metrics: SchemeMetrics,
): PolarityBalanceWarning[] {
  return metrics.shells.flatMap((shell) => {
    const warningThreshold = polarityBalanceWarningThreshold(shell.directions)
    return shell.mean.norm > warningThreshold
      ? [
          {
            bval: shell.bval,
            directions: shell.directions,
            meanNorm: shell.mean.norm,
            warningThreshold,
          },
        ]
      : []
  })
}

/** Quantitative QC for console reporting and regression tests. */
export function measureScheme(scheme: GenScheme): SchemeMetrics {
  const diffusion = scheme.dirs.filter((d) => d.bval > 0)
  const minSeparation = (dirs: GenDir[], antipodal: boolean): number => {
    let min = Math.PI
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        let dot =
          dirs[i].x * dirs[j].x + dirs[i].y * dirs[j].y + dirs[i].z * dirs[j].z
        if (antipodal) dot = Math.abs(dot)
        min = Math.min(min, Math.acos(clamp(dot, -1, 1)))
      }
    }
    return (min * 180) / Math.PI
  }
  const bvals = [...new Set(diffusion.map((d) => d.bval))].sort((a, b) => a - b)
  return {
    combinedMinAxisSeparationDeg: minSeparation(diffusion, true),
    shells: bvals.map((bval) => {
      const dirs = diffusion.filter((d) => d.bval === bval)
      const sum = dirs.reduce(
        (s, d) => ({ x: s.x + d.x, y: s.y + d.y, z: s.z + d.z }),
        { x: 0, y: 0, z: 0 },
      )
      const mean = {
        x: sum.x / dirs.length,
        y: sum.y / dirs.length,
        z: sum.z / dirs.length,
        norm: Math.hypot(sum.x, sum.y, sum.z) / dirs.length,
      }
      const hemisphere = (axis: 'x' | 'y' | 'z') => ({
        positive: dirs.filter((d) => d[axis] >= 0).length,
        negative: dirs.filter((d) => d[axis] < 0).length,
      })
      return {
        bval,
        directions: dirs.length,
        mean,
        hemispheres: {
          x: hemisphere('x'),
          y: hemisphere('y'),
          z: hemisphere('z'),
        },
        minAxisSeparationDeg: minSeparation(dirs, true),
        minSavedSeparationDeg: minSeparation(dirs, false),
      }
    }),
  }
}

/**
 * Serialize to a Siemens DVS (the `multishell.py` variant: `[directions=N]`,
 * `coordinatesystem=xyz`, `Vector[i] = (x, y, z)`). Each direction is scaled to
 * |g| = √(b/b_max) so its length encodes the shell's diffusion weighting.
 */
export function schemeToDvs(scheme: GenScheme): string {
  validateSchemeForSerialization(scheme)
  const bmax = scheme.maxBval
  const nB0 = countB0(scheme)
  const lines: string[] = [
    `# Diffusion vector set generated by dwi2trx — ${describeShells(scheme.shells)}${nB0 ? `, ${nB0} b0` : ''}.`,
    `# ${methodLabel(scheme.method)} antipodal electrostatic-repulsion relaxation.`,
    `# ${orderingDescription(scheme.method)}`,
    '# Polarity-balanced whole-sphere sampling for FSL Eddy:',
    '# https://fsl.fmrib.ox.ac.uk/fsl/docs/diffusion/eddy/index.html',
    '# Verify coverage before scanner use.',
    `[directions=${scheme.dirs.length}]`,
    'coordinatesystem=xyz',
    'normalisation = none',
  ]
  scheme.dirs.forEach((d, i) => {
    const [x, y, z] = scaledComponents(d, bmax)
    lines.push(`Vector[${i}]  = (${x}, ${y}, ${z})`)
  })
  return `${lines.join('\n')}\n`
}

function validateSchemeForSerialization(scheme: GenScheme): void {
  if (!Number.isFinite(scheme.maxBval) || scheme.maxBval <= 0)
    throw new Error('Maximum b-value must be positive and finite.')
  if (scheme.dirs.length === 0)
    throw new Error('A scheme must contain at least one volume.')
  for (const d of scheme.dirs) {
    if (![d.x, d.y, d.z, d.bval].every(Number.isFinite))
      throw new Error('Directions must contain only finite numbers.')
    if (d.bval < 0) throw new Error('Direction b-values cannot be negative.')
    // Both formats encode weighting as |g| = √(b/b_max), so b > b_max would emit
    // |g| > 1 — which the GE spec forbids and no scanner can deliver.
    if (d.bval > scheme.maxBval)
      throw new Error('Direction b-values cannot exceed the maximum b-value.')
  }
}

function scaledComponents(d: GenDir, bmax: number): [string, string, string] {
  const g = d.bval > 0 ? Math.sqrt(d.bval / bmax) : 0
  return [(d.x * g).toFixed(6), (d.y * g).toFixed(6), (d.z * g).toFixed(6)]
}

function orderingDescription(method: GenMethod): string {
  return method === 'incremental'
    ? 'Incremental construction order preserved for useful truncated prefixes.'
    : 'Duty-cycle-balanced ordering: shells mixed; recent X/Y/Z demand minimized.'
}

/** Serialize one GE custom tensor table. GE encodes effective b-value in vector
 * magnitude: b_effective=b_max*(x²+y²+z²). Fields are SPACE-separated for
 * compatibility with software before 29.1; every line ends with LF (0x0A). */
export function schemeToGeDat(scheme: GenScheme): string {
  validateSchemeForSerialization(scheme)
  if (
    scheme.dirs.length < GE_DAT_MIN_DIRECTIONS ||
    scheme.dirs.length > GE_DAT_MAX_DIRECTIONS
  ) {
    throw new Error(
      `GE tensor DAT requires ${GE_DAT_MIN_DIRECTIONS}–${GE_DAT_MAX_DIRECTIONS} volumes.`,
    )
  }
  const nB0 = countB0(scheme)
  const lines: string[] = [
    '# Multi-shell tensor file generated by dwi2trx',
    '# Diffusion gradient vectors for GE scanners',
    '# GE logical coordinates: X=frequency, Y=phase, Z=slice',
    `# Set the console maximum b-value to ${scheme.maxBval} s/mm2`,
    `# Diffusion tab: number of directions (TENSOR): ${scheme.dirs.length}`,
    `# ${describeShells(scheme.shells)}${nB0 ? `, ${nB0} b0` : ''}`,
    `# ${methodLabel(scheme.method)} antipodal electrostatic-repulsion relaxation`,
    `# ${orderingDescription(scheme.method)}`,
    '# Rename to tensorNNNN.dat and select NNNN with CV11',
    '#',
    String(scheme.dirs.length),
  ]
  for (const d of scheme.dirs)
    lines.push(scaledComponents(d, scheme.maxBval).join(' '))
  return `${lines.join('\n')}\n`
}

/**
 * Philips `dti_vectors_input.txt`: unit x/y/z plus the explicit b-value — Philips
 * carries b in its own column, so do NOT amplitude-scale like the Siemens/GE
 * writers above.
 *
 * Two rules from dcm2niix `Philips/README.md` are enforced below: a b=0 row must be
 * FIRST, and repeated b0s must each specify a UNIQUE direction (spaced around the
 * XY circle) — a zero-vector b0 is not a documented form. The header is optional and
 * omitted. NOTE the README's example is TAB-separated and LF-terminated; the 3-space
 * + CRLF form here is unverified (no source states a separator/EOL rule — the
 * console is Windows, so CRLF is a safe guess, not a spec). Per that README these
 * custom files only work with Philips FiberTrak when every b-value shares the same
 * directions, which a per-shell-optimized scheme never does.
 */
export function schemeToPhilipsTxt(scheme: GenScheme): string {
  validateSchemeForSerialization(scheme)
  if (scheme.dirs[0].bval !== 0)
    throw new Error('Philips vector tables must start with a b=0 volume.')
  const component = (value: number): string =>
    (Math.abs(value) < 0.5e-6 ? 0 : value).toFixed(6)
  const b0Count = countB0(scheme)
  let b0Index = 0
  const lines = scheme.dirs.map((dir) => {
    if (dir.bval === 0) {
      const angle = (2 * Math.PI * b0Index++) / b0Count
      return `${component(Math.cos(angle))}   ${component(Math.sin(angle))}   0.000000   0`
    }
    const length = Math.hypot(dir.x, dir.y, dir.z)
    if (length <= Number.EPSILON)
      throw new Error('Philips diffusion directions must be non-zero.')
    return `${component(dir.x / length)}   ${component(dir.y / length)}   ${component(dir.z / length)}   ${dir.bval}`
  })
  return `${lines.join('\r\n')}\r\n`
}

/** A filename-safe descriptor of the scheme, e.g. `30x1000_30x2000`. */
export function schemeBaseName(shells: ShellSpec[]): string {
  return shells.map((s) => `${s.count}x${s.bval}`).join('_')
}

/** Round to the nearest multiple of 3 (min 3). Diffusion protocols favour
 *  direction counts divisible by 3, and it reproduces the √b reference tables. */
function roundDirs(x: number): number {
  return Math.max(3, 3 * Math.round(x / 3))
}

/**
 * Square-root rule: scale the previous shell's count by √(newBval/lastBval), a
 * common starting heuristic for allocating more directions at higher b-values.
 * It compounds shell-to-shell (24@1000 → 33@2000 → 39@3000 → 45@4000).
 */
export function sqrtRuleCount(
  lastCount: number,
  lastBval: number,
  newBval: number,
): number {
  if (lastBval <= 0 || lastCount <= 0 || newBval <= 0) return 24
  return roundDirs(lastCount * Math.sqrt(newBval / lastBval))
}

/** The shell to append when the user adds one: b-value + 1000, with directions
 *  set by the √b rule off the last shell (a sensible starting point to edit). */
export function suggestNextShell(shells: ShellSpec[]): ShellSpec {
  const last = shells[shells.length - 1]
  if (!last || last.bval <= 0) return { count: 24, bval: 1000 }
  const bval = last.bval + 1000
  return { count: sqrtRuleCount(last.count, last.bval, bval), bval }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
