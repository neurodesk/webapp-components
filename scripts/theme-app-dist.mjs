#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findApp, loadAppsRegistry, repoRoot } from './lib/apps-registry.mjs';
import { applyAppTheme } from './lib/app-theme-dist.mjs';
import { appInformationPayload, loadAppInformation } from './lib/app-information.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const appId = option('--app');
if (!appId) throw new Error('Usage: node scripts/theme-app-dist.mjs --app <app-id>');

const registry = await loadAppsRegistry();
const information = appInformationPayload(await loadAppInformation(registry), appId);
const app = findApp(registry, appId);
const appPackage = JSON.parse(await readFile(join(repoRoot, 'apps', appId, 'package.json'), 'utf8'));

await applyAppTheme({
  app,
  information,
  version: appPackage.version,
  measurementId: registry.site.analytics.measurement_id,
  distDir: join(repoRoot, 'apps', appId, 'dist'),
  themeFile: join(repoRoot, 'site', 'app-theme.css'),
  themeScriptFile: join(repoRoot, 'site', 'theme.js'),
  shellFile: join(repoRoot, 'site', 'app-shell.js'),
  shellAdaptersDir: join(repoRoot, 'site', 'shell-adapters'),
  analyticsFile: join(repoRoot, 'packages', 'analytics', 'src', 'index.js'),
  iconFile: join(repoRoot, 'site', 'neurodesk-logo.svg'),
});

console.log(`Applied the Neurodesk theme to the ${appId} standalone bundle`);
