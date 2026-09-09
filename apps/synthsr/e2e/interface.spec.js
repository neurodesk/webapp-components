import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`input stays compact at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    const picker = page.locator('#imageInput');
    await expect(picker).toBeVisible();
    expect((await picker.boundingBox()).height).toBeLessThanOrEqual(48);
    expect((await page.locator('#inputSection').boundingBox()).height).toBeLessThanOrEqual(220);
    await expect(page.locator('#exampleImages')).not.toHaveAttribute('open', '');
  });
}

test('shared examples load through the image workflow and preserve input on failure', async ({ page }) => {
  const { NIFTI_EXAMPLES } = await import('@neurodesk/webapp-components/example-images');
  const { fileURLToPath } = await import('node:url');
  const fixture = fileURLToPath(new URL('../test/fixtures/validation.nii.gz', import.meta.url));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  const summary = page.locator('#exampleImages > summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#exampleSelect option')).toHaveText(['FLAIR', ...NIFTI_EXAMPLES.map(example => example.id)]);
  for (const id of ['chris_t1', 'CT_Philips']) {
    const example = NIFTI_EXAMPLES.find(example => example.id === id);
    await page.route(example.url, route => route.fulfill({ path: fixture, contentType: 'application/octet-stream' }));
    await page.locator('#exampleSelect').selectOption(id);
    await page.locator('#exampleBtn').click();
    await expect(page.locator('#fileInfo')).toContainText(`${id}.nii.gz`);
    await expect(page.locator('#processButton')).toBeEnabled();
    await expect(page.locator('#modality')).toHaveValue(example.modality);
  }
  await summary.click();
  await expect(page.locator('#exampleSelect')).toBeHidden();
  await summary.click();
  await expect(page.locator('#exampleSelect')).toHaveValue('CT_Philips');
  const failedExample = NIFTI_EXAMPLES.find(example => example.id === 'mni152');
  await page.route(failedExample.url, route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('#exampleSelect').selectOption('mni152');
  await page.locator('#exampleBtn').click();
  await expect(page.locator('#statusText')).toContainText('Example download failed');
  await expect(page.locator('#fileInfo')).toContainText('CT_Philips.nii.gz');
  await expect(page.locator('#modality')).toHaveValue('ct');
  await expect(page.locator('#processButton')).toBeEnabled();
  await expect(page.locator('#outputSection')).not.toHaveAttribute('open', '');
});
