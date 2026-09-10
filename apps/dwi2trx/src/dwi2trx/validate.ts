/**
 * Pure validation helpers for diffusion inputs — no DOM, no NiiVue, no async,
 * so they unit-test in plain node (see validate.test.ts).
 */

/** Strip the recognized diffusion-file extension to group a series' sidecars. */
export function baseName(name: string): string {
  return name.replace(/\.(nii\.gz|nii|bval|bvec|json)$/i, '')
}

export const isNifti = (name: string): boolean => /\.nii(\.gz)?$/i.test(name)
export const isBval = (name: string): boolean => /\.bval$/i.test(name)
export const isBvec = (name: string): boolean => /\.bvec$/i.test(name)
export const isJson = (name: string): boolean => /\.json$/i.test(name)

/** Parse whitespace-separated numbers from one line (or the whole file). */
export function parseNumbers(text: string): number[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map(Number)
}

/** Parsed FSL diffusion gradients: one bval per volume + three bvec rows. */
export interface ParsedGradients {
  bvals: number[]
  bvecs: [number[], number[], number[]]
}

/**
 * Parse + validate an FSL-layout bval/bvec pair (bval = one row of V values;
 * bvec = 3 rows of V values). Single source of truth for the checks: empty,
 * finite, non-negative b-values, 3 rows, matching lengths. Throws a
 * caller-facing Error on any problem.
 */
export function parseBvalBvec(
  bvalText: string,
  bvecText: string,
): ParsedGradients {
  const bvals = parseNumbers(bvalText)
  if (bvals.length === 0) throw new Error('bval file is empty.')
  if (!bvals.every(Number.isFinite)) {
    throw new Error('bval contains non-numeric or non-finite values.')
  }
  if (bvals.some((b) => b < 0)) {
    throw new Error('bval contains negative values.')
  }

  const rows = bvecText
    .trim()
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map(parseNumbers)
  if (rows.length !== 3) {
    throw new Error(`bvec must have 3 rows (x/y/z), found ${rows.length}.`)
  }
  for (const v of rows) {
    if (v.length !== bvals.length) {
      throw new Error(
        `bvec row has ${v.length} values but bval lists ${bvals.length} directions.`,
      )
    }
    if (!v.every(Number.isFinite)) {
      throw new Error('bvec contains non-numeric or non-finite values.')
    }
  }
  return { bvals, bvecs: [rows[0], rows[1], rows[2]] }
}

/**
 * Validate a bval/bvec pair and return the gradient-direction count. Thin
 * wrapper over {@link parseBvalBvec}.
 */
export function countDirections(bvalText: string, bvecText: string): number {
  return parseBvalBvec(bvalText, bvecText).bvals.length
}

/** A diffusion-series candidate: gradient directions (bval) vs NIfTI 4D volumes. */
export interface SeriesCounts {
  directions: number
  volumes: number
}

/**
 * Pick the best series: among candidates whose NIfTI volume count matches their
 * bval/bvec direction count, return the index with the most directions (README:
 * "the diffusion series ... with the most volumes"). Returns -1 if none match —
 * so a series with a broken NIfTI never shadows a valid smaller one.
 */
export function chooseBestSeries(candidates: SeriesCounts[]): number {
  let best = -1
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (c.directions !== c.volumes) continue
    if (best < 0 || c.directions > candidates[best].directions) best = i
  }
  return best
}

/** Negate the x row of FSL bvec text (rows x, y, z); other rows pass through verbatim. */
export function flipBvecX(bvecText: string): string {
  const rows = bvecText.trim().split(/\r?\n/)
  rows[0] = parseNumbers(rows[0])
    .map((v) => (v === 0 ? '0' : String(-v)))
    .join(' ')
  return rows.join('\n')
}
