import { expect, test } from '@playwright/test';

test('renders model metadata from the generated catalog', async ({ page }) => {
  await page.goto('/index.html');
  const modelOptions = page.locator('#modelSelect option');
  await expect(modelOptions).toHaveCount(7);
  await expect(modelOptions.first()).toHaveText('Whole Body (113 structures, v1.4)');
  await expect(modelOptions.nth(1)).toHaveText('Whole Body (99 structures, v1.3 — legacy)');
  await expect(page.locator('#overlapSelect')).toHaveValue('0.9');

  if (await page.locator('#enterAppButton').isVisible()) await page.locator('#enterAppButton').click();
  await page.getByRole('button', { name: 'Inference Settings' }).click();
  await page.locator('#modelSelect').selectOption('musclemap-wholebody-v1.3');
  await expect(page.locator('#overlapSelect')).toHaveValue('0.5');
  await expect(page.locator('#aboutModelVersion')).toHaveText('v1.3');
  await expect(page.locator('#aboutStructureCount')).toHaveText('99');

  await page.locator('#modelSelect').selectOption('musclemap-wholebody-v1.4');

  await expect(page.locator('#aboutModelVersion')).toHaveText('v1.4');
  await expect(page.locator('#aboutStructureCount')).toHaveText('113');
  await expect(page.locator('#aboutModelCitation')).toHaveText('10.5281/zenodo.21929873');
});
