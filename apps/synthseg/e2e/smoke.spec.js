// Real browser smoke test against the built, header-served output (see playwright.config.js).
import { expect, test } from '@playwright/test';

test('app boots with the shared bar', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#controls')).toBeVisible();
  await expect(page.locator("#imageInput[data-neurodesk-input='image']")).toHaveCount(1);
  await expect(page.locator('.nd-app-bar')).toHaveCount(1);
  for (const name of ['About', 'Cite', 'Privacy']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('About opens from the shared bar and the theme toggles', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#controls > #aboutBtn')).toBeHidden();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.locator('.nd-app-dialog[data-dialog="about"]')).toBeVisible();
  await page.locator('.nd-app-dialog[data-dialog="about"] .nd-app-dialog__close').click();
  await expect(page.locator('.nd-app-dialog[data-dialog="about"]')).toBeHidden();
  await page.getByRole('button', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-neurodesk-theme', 'light');
});

test('a browser without WebGPU explains itself and keeps Run disabled', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }); });
  await page.goto('./');
  await expect(page.locator('#statusText')).toContainText('WebGPU');
  await expect(page.locator('#processButton')).toBeDisabled();
});

test('WebGPU is available in this Chromium', async ({ page }) => {
  await page.goto('./');
  expect(await page.evaluate(() => Boolean(navigator.gpu))).toBe(true);
});

test('local image parsing stays busy until it can commit the selected scan', async ({ page }) => {
  await page.addInitScript(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'small.nii.gz') {
        await new Promise((resolve) => { window.finishImageRead = resolve; });
      }
      return read.call(this);
    };
  });
  await page.goto('./');
  await page.locator('#imageInput').setInputFiles('../../exes/synthseg/test/fixtures/small.nii.gz');
  await expect.poll(() => page.evaluate(() => Boolean(window.finishImageRead))).toBe(true);
  await expect(page.locator('#imageInput')).toBeDisabled();
  await expect(page.locator('#cancelBtn')).toBeHidden();
  await page.evaluate(() => window.finishImageRead());
  await expect(page.locator('#statusText')).toContainText('Image loaded');
  await expect(page.locator('#imageInput')).toBeEnabled();
});

test('cancelled inference cannot publish a stale worker message', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (String(url).includes('inference-worker')) {
          const fake = { postMessage() {}, terminate() {} };
          window.inferenceWorker = fake;
          return fake;
        }
        super(url, options);
      }
    };
  });
  await page.goto('./');
  await page.locator('#imageInput').setInputFiles('../../exes/synthseg/test/fixtures/small.nii.gz');
  await expect(page.locator('#processButton')).toBeEnabled();
  await page.locator('#processButton').click();
  await expect(page.locator('#cancelBtn')).toBeVisible();
  await page.locator('#cancelBtn').click();
  await page.evaluate(() => window.inferenceWorker.onmessage({ data: { type: 'error', message: 'stale result' } }));
  await expect(page.locator('#statusText')).toContainText('Processing cancelled');
  await expect(page.locator('#reportBtn')).toBeDisabled();
});
