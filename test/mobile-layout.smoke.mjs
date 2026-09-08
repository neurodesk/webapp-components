#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { loadAppsRegistry, repoRoot } from '../scripts/lib/apps-registry.mjs';
import { verifyMobileImageImport, verifyMobileMeasurement } from '../test-utils/mobile-imaging.mjs';

const dist = join(repoRoot, 'dist');
const registry = await loadAppsRegistry();
const requestedAppIds = new Set((process.env.SMOKE_APPS ?? '').split(',').filter(Boolean));
const appsUnderTest = requestedAppIds.size
  ? registry.apps.filter(({ id }) => requestedAppIds.has(id))
  : registry.apps;
if (appsUnderTest.length !== (requestedAppIds.size || registry.apps.length)) {
  const found = new Set(appsUnderTest.map(({ id }) => id));
  const missing = [...requestedAppIds].filter((id) => !found.has(id));
  throw new Error(`Unknown SMOKE_APPS entries: ${missing.join(', ')}`);
}
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
]);

function resolveRequest(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  if (relative.startsWith('..')) return null;
  return join(dist, relative);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/qsm-nav.js') {
      // QSMbly deliberately selects a local ecosystem-bar script on localhost.
      // Production uses qsmxt.github.io; this fixture keeps the composite smoke
      // focused on the deployed subpath without requiring that external script.
      const body = '/* QSM ecosystem navigation smoke fixture */';
      response.writeHead(200, {
        'content-length': Buffer.byteLength(body),
        'content-type': 'text/javascript; charset=utf-8',
      }).end(body);
      return;
    }
    let path = resolveRequest(url.pathname);
    if (!path) {
      response.writeHead(400).end('Bad request');
      return;
    }

    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      response.writeHead(404).end('Not found');
      return;
    }

    if (metadata.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(308, { location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      path = join(path, 'index.html');
      metadata = await stat(path);
    }

    response.writeHead(200, {
      'content-length': metadata.size,
      'content-type': mimeTypes.get(extname(path)) ?? 'application/octet-stream',
      'cross-origin-embedder-policy': 'credentialless',
      'cross-origin-opener-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(path).pipe(response);
  } catch (error) {
    response.writeHead(500).end(error.message);
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] });
const failures = [];
const screenshotDir = process.env.MOBILE_SCREENSHOTS;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
];

async function checkLayout(page, label) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const visible = element => element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const describe = element => element.id || `${element.tagName.toLowerCase()}.${String(element.className).trim().replaceAll(' ', '.')}`;
    const scrollableAncestor = element => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const rect = parent.getBoundingClientRect();
        if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX)
            && rect.left >= 0 && rect.right <= width + 1 && parent.scrollWidth > parent.clientWidth) return true;
      }
      return false;
    };
    return {
      pageOverflow: document.documentElement.scrollWidth > width + 1,
      overflow: [...document.querySelectorAll('body *')].filter(visible).filter(element => {
        const rect = element.getBoundingClientRect();
        return (rect.right > width + 1 || rect.left < -1) && !scrollableAncestor(element);
      }).slice(0, 8).map(describe),
      smallNavigation: [...document.querySelectorAll('.nd-app-bar__action')].filter(visible)
        .filter(element => element.getBoundingClientRect().width < 44 || element.getBoundingClientRect().height < 44).map(describe),
      smallInputs: [...document.querySelectorAll('input:not([type]), input[type="text"], input[type="number"], input[type="url"], select, textarea')]
        .filter(visible).filter(element => Number.parseFloat(getComputedStyle(element).fontSize) < 16).map(describe),
    };
  });
  const failed = result.pageOverflow || result.overflow.length || result.smallNavigation.length || result.smallInputs.length;
  if (failed) failures.push(`${label}: ${JSON.stringify(result)}`);
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${label.replaceAll('/', '-')}.png`) });
  console.log(`${failed ? 'FAIL' : 'PASS'} ${label}${failed ? ' ' + JSON.stringify(result) : ''}`);
}

try {
  for (const app of [{ id: 'catalog', path: '' }, ...appsUnderTest]) {
    const context = await browser.newContext({ viewport: viewports[1], isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/,
      route => route.fulfill({ status: 200, body: '' }));
    try {
      const response = await page.goto(`${origin}/${app.path}${app.path ? '/' : ''}`, { waitUntil: 'domcontentloaded' });
      expect(response.status()).toBe(200);
      if (app.id !== 'catalog') await expect(page.locator('.nd-app-bar:visible').first()).toBeVisible();
      for (const phase of ['entry', 'workspace']) {
        if (phase === 'workspace') {
          const enter = page.locator('#enterAppButton, #landingLaunch').filter({ visible: true }).first();
          if (await enter.count()) await enter.tap();
          if (app.id === 'dicompare') await page.getByRole('link', { name: 'Open Workspace', exact: true }).tap();
          const welcome = page.locator('#welcomeLater');
          if (await welcome.isVisible()) await welcome.tap();
        }
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          await checkLayout(page, `${app.id}/${phase}/${viewport.width}`);
          if (phase === 'entry') {
            const enter = page.locator('#enterAppButton, #landingLaunch').filter({ visible: true }).first();
            if (await enter.count()) await enter.tap({ trial: true });
          }
        }
      }
      if (app.id !== 'catalog') {
        await page.setViewportSize(viewports[0]);
        const theme = page.locator('.nd-app-bar:visible [data-neurodesk-theme-toggle]').first();
        const previous = await page.locator('html').getAttribute('data-neurodesk-theme');
        await theme.tap();
        await expect(page.locator('html')).not.toHaveAttribute('data-neurodesk-theme', previous);
        await checkLayout(page, `${app.id}/light/320`);
        for (const viewport of [viewports[0], viewports[3]]) {
          await page.setViewportSize(viewport);
          await page.locator('.nd-app-bar:visible button[title="Privacy"]').first().tap();
          const dialog = page.locator('dialog[open], .modal-overlay.active .modal, .nd-modal-overlay.active .nd-modal, [role="dialog"][aria-label="Privacy"]').last();
          await expect(dialog).toBeVisible();
          const bounds = await dialog.boundingBox();
          expect(bounds.y).toBeGreaterThanOrEqual(0);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
          await checkLayout(page, `${app.id}/privacy/${viewport.width}`);
          await dialog.locator('.modal-close, .nd-modal-close, .nd-app-dialog__close, [aria-label="Close privacy"]').first().tap();
          await expect(dialog).toBeHidden();
        }
      }
      if (app.id === 'qsmbly') {
        for (const viewport of [viewports[0], viewports[3]]) {
          await page.setViewportSize(viewport);
          for (const tab of ['viewer', 'console', 'controls']) {
            await page.locator(`.mobile-tab[data-tab="${tab}"]`).tap();
            await expect(page.locator('.app-container')).toHaveAttribute('data-mobile-tab', tab);
            await checkLayout(page, `${app.id}/${tab}/${viewport.width}`);
            if (tab === 'viewer') {
              const canvas = await page.locator('.viewer-canvas-wrapper').boundingBox();
              expect(canvas.height).toBeGreaterThanOrEqual(120);
              expect(canvas.y + canvas.height).toBeLessThanOrEqual(viewport.height);
            }
          }
        }
      }
      if (app.id === 'musclemap') {
        await verifyMobileImageImport(page);
        await checkLayout(page, `${app.id}/image-import/320`);
      }
      if (app.id === 'zarro') {
        await verifyMobileMeasurement(page, origin);
        await checkLayout(page, `${app.id}/touch-measurement/390`);
      }
    } catch (error) {
      failures.push(`${app.id}: ${error.message}`);
      console.error(`FAIL ${app.id}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
if (failures.length) throw new Error(`Mobile failures:\n${failures.join('\n')}`);
console.log(`Mobile layouts and touch navigation passed for all ${appsUnderTest.length} apps and the catalog.`);
