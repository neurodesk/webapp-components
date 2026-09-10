// Emit src/freesurfer-lut.json (NiiVue label colormap) for the 33 SynthSeg labels
// from FreeSurferColorLUT.txt. Usage: node scripts/freesurfer-lut.mjs /path/to/FreeSurferColorLUT.txt
import { readFileSync, writeFileSync } from 'node:fs';

// Must match LABELS in exes/synthseg/src/post.rs.
const LABELS = [0, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 24, 26, 28, 41, 42, 43, 44, 46, 47, 49, 50, 51, 52, 53, 54, 58, 60];
const rows = new Map(readFileSync(process.argv[2], 'utf8').split('\n')
  .map((line) => line.trim().split(/\s+/)).filter((f) => /^\d+$/.test(f[0]))
  .map(([i, name, r, g, b]) => [Number(i), { name, r: Number(r), g: Number(g), b: Number(b) }]));
const lut = { I: LABELS, R: [], G: [], B: [], A: [], labels: [] };
for (const i of LABELS) {
  const { name, r, g, b } = rows.get(i);
  lut.R.push(r); lut.G.push(g); lut.B.push(b); lut.A.push(i ? 255 : 0); lut.labels.push(name);
}
writeFileSync(new URL('../src/freesurfer-lut.json', import.meta.url), JSON.stringify(lut) + '\n');
