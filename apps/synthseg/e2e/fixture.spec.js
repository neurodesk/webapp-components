// Full in-browser run against the real model, gated because it needs a local
// synthseg-2.0.onnx (SYNTHSEG_ASSET_DIR) and a usable WebGPU adapter.
// SYNTHSEG_E2E_FIXTURE=1 SYNTHSEG_ASSET_DIR=../../exes/synthseg/models pnpm --filter synthseg test:e2e
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

const fixtures = '../../exes/synthseg/test/fixtures';

function labels(bytes) {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const dims = [1, 2, 3].map((i) => view.getInt16(40 + i * 2, true));
  const start = Math.ceil(view.getFloat32(108, true));
  const data = new Int32Array(dims[0] * dims[1] * dims[2]);
  for (let i = 0; i < data.length; i++) data[i] = view.getInt32(start + i * 4, true);
  return { dims, data };
}

test.skip(!process.env.SYNTHSEG_E2E_FIXTURE, 'set SYNTHSEG_E2E_FIXTURE=1 to run the real model in the browser');

async function segment(page, input, mode) {
  await page.goto('./');
  await page.locator('#imageInput').setInputFiles(input);
  await expect(page.locator('#processButton')).toBeEnabled({ timeout: 60000 });
  await page.locator('#mode').selectOption(mode);
  await page.locator('#processButton').click();
  await expect(page.locator('#statusText')).toContainText('Labels ready', { timeout: 1700000 });
  const download = await Promise.all([page.waitForEvent('download'), page.locator('#saveBtn').click()]).then(([d]) => d);
  const report = await Promise.all([page.waitForEvent('download'), page.locator('#reportBtn').click()]).then(([d]) => d);
  return { labels: labels(readFileSync(await download.path())), name: download.suggestedFilename(),
    provenance: JSON.parse(readFileSync(await report.path(), 'utf8')) };
}

function gate(produced, golden, limit) {
  expect(produced.dims).toEqual(golden.dims);
  let mismatches = 0;
  for (let i = 0; i < golden.data.length; i++) if (produced.data[i] !== golden.data[i]) mismatches++;
  expect(mismatches / golden.data.length).toBeLessThanOrEqual(limit);
  return mismatches;
}

test('segments the small fixture and matches the FreeSurfer golden', async ({ page }) => {
  test.setTimeout(1800000);
  const { labels: produced, name } = await segment(page, `${fixtures}/small.nii.gz`, 'default');
  expect(name).toBe('small_synthseg.nii.gz');
  const mismatches = gate(produced, labels(readFileSync(`${fixtures}/small_default.nii.gz`)), 5e-6);
  console.log(`small default: ${mismatches}/${produced.data.length} mismatched`);
});

// Real volumes and FreeSurfer goldens (make -C exes/synthseg fetch-validation); writes validation/report.json.
const references = process.env.SYNTHSEG_REFERENCE_DIR;
test('segments the benchmark volumes within the native parity gate', async ({ page }) => {
  test.skip(!references, 'set SYNTHSEG_REFERENCE_DIR to run the real volumes');
  test.setTimeout(3600000);
  const results = [];
  for (const stem of ['T1_head', 'T1_head_2mm']) for (const mode of ['fast', 'default']) {
    const { labels: produced, provenance } = await segment(page, `${references}/${stem}.nii.gz`, mode);
    const mismatches = gate(produced, labels(readFileSync(`${references}/${stem}_${mode}.nii.gz`)), 2e-6);
    results.push({ device: 'webgpu', input: stem, mode, mismatched_voxels: mismatches, compared_voxels: produced.data.length,
      mismatch_fraction: mismatches / produced.data.length, seconds: provenance.seconds, timings: provenance.timings, pass: true });
    console.log(`${stem} ${mode}: ${mismatches} mismatched, ${provenance.seconds.toFixed(1)} s`);
  }
  writeFileSync('validation/report.json', JSON.stringify({ results }, null, 2) + '\n');
});
