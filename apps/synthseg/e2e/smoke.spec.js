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
  await expect(page.locator('#aboutDialog')).toBeVisible();
  await page.locator('#aboutDialog .nd-app-dialog__close').click();
  await expect(page.locator('#aboutDialog')).toBeHidden();
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
