import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadAppsRegistry, repoRoot } from '../scripts/lib/apps-registry.mjs';
import {
  DATE_VERSION, EMBEDDED_VERSION_SITES, LINKED_PACKAGES, applyRelease, embeddedVersionMismatches, nextVersion, parseChangeset,
  planRelease, releaseDate, syncEmbeddedVersions, workspacePackages,
} from '../scripts/lib/app-versions.mjs';

const registry = await loadAppsRegistry();
const packages = await workspacePackages();

test('every app is versioned MAJOR.MINOR.YYYYMMDD', () => {
  for (const app of registry.apps) {
    const pkg = [...packages.values()].find((item) => item.group === 'apps' && item.id === app.id);
    assert.ok(pkg, `${app.id} has a package.json`);
    assert.match(pkg.manifest.version, DATE_VERSION, `${app.id} version ${pkg.manifest.version} must be MAJOR.MINOR.YYYYMMDD`);
    const date = pkg.manifest.version.split('.')[2];
    assert.ok(date >= '20260101' && date <= releaseDate(), `${app.id} release date ${date} must be a real past date`);
  }
});

test('embedded version strings and linked packages match their app', async () => {
  assert.deepEqual(await embeddedVersionMismatches(packages), []);
  for (const [linked, appId] of Object.entries(LINKED_PACKAGES)) {
    assert.ok(packages.get(linked), `${linked} exists`);
    assert.ok(registry.apps.some((app) => app.id === appId), `${appId} is registered`);
  }
});

test('nextVersion keeps major.minor for patches and dates the release', () => {
  assert.equal(nextVersion('1.4.7', 'patch', '20260910'), '1.4.20260910');
  assert.equal(nextVersion('1.4.20260910', 'patch', '20260911'), '1.4.20260911');
  assert.equal(nextVersion('1.4.20260910', 'minor', '20260911'), '1.5.20260911');
  assert.equal(nextVersion('1.4.20260910', 'major', '20260911'), '2.0.20260911');
  assert.throws(() => nextVersion('nope', 'patch', '20260911'), /Cannot derive/);
});

test('changesets are parsed and same-day republishing is explicit', () => {
  const changeset = parseChangeset('---\n"musclemap": patch\n"@neurodesk/webapp-components": minor\n---\n\nImprove things.\n', 'x.md');
  assert.deepEqual(changeset.releases, [{ name: 'musclemap', bump: 'patch' }, { name: '@neurodesk/webapp-components', bump: 'minor' }]);
  const fake = new Map([
    ['musclemap', { name: 'musclemap', id: 'musclemap', group: 'apps', directory: '/x', manifest: { version: '1.4.20260910' } }],
    ['@neurodesk/webapp-components', { name: '@neurodesk/webapp-components', id: 'components', group: 'packages', directory: '/y', manifest: { version: '0.1.3' } }],
  ]);
  assert.throws(() => planRelease([changeset], fake, { date: '20260910' }), /already at 1\.4\.20260910/);
  const plan = planRelease([changeset], fake, { date: '20260910', sameDay: true });
  assert.deepEqual(plan.map((item) => [item.id, item.version]), [['musclemap', '1.4.20260910']]);
  assert.deepEqual(planRelease([changeset], fake, { date: '20260911' }).map((item) => item.version), ['1.4.20260911']);
});

test('applyRelease writes versions, changelogs, linked packages and embedded sites in a scratch repo', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'app-versions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'apps', 'zarro', 'src'), { recursive: true });
  await mkdir(join(root, 'apps', 'synthsr'), { recursive: true });
  await mkdir(join(root, 'packages', 'synthsr'), { recursive: true });
  await mkdir(join(root, 'exes', 'synthsr'), { recursive: true });
  await writeFile(join(root, 'apps', 'zarro', 'package.json'), JSON.stringify({ name: 'zarro', version: '0.1.24' }));
  await writeFile(join(root, 'apps', 'zarro', 'src', 'config.js'), "export const APP = {\n  version: '0.1.24',\n};\n");
  await writeFile(join(root, 'apps', 'zarro', 'CHANGELOG.md'), '# zarro\n\n## 0.1.24\n\n### Patch Changes\n\n- Old.\n');
  await writeFile(join(root, 'apps', 'synthsr', 'package.json'), JSON.stringify({ name: 'synthsr', version: '0.2.20260910' }));
  await writeFile(join(root, 'packages', 'synthsr', 'package.json'), JSON.stringify({ name: '@neurodesk/synthsr', version: '0.2.20260910' }));
  await writeFile(join(root, 'exes', 'synthsr', 'Cargo.toml'), '[package]\nname = "synthsr"\nversion = "0.2.20260910"\n\n[dependencies]\nort = { version = "=2.0.0" }\n');
  await writeFile(join(root, 'exes', 'synthsr', 'Cargo.lock'), '[[package]]\nname = "synthsr"\nversion = "0.2.20260910"\n');
  const scratch = await workspacePackages(root);
  const plan = planRelease([
    parseChangeset('---\n"zarro": patch\n"synthsr": minor\n---\n\nShip it.\n', 'a.md'),
    parseChangeset('---\n"zarro": patch\n---\n\nAnd this.\n', 'b.md'),
  ], scratch, { date: '20260911' });
  await applyRelease(plan, scratch, { root });
  assert.equal(JSON.parse(await readFile(join(root, 'apps', 'zarro', 'package.json'), 'utf8')).version, '0.1.20260911');
  assert.match(await readFile(join(root, 'apps', 'zarro', 'src', 'config.js'), 'utf8'), /version: '0\.1\.20260911'/);
  const changelog = await readFile(join(root, 'apps', 'zarro', 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.startsWith('# zarro\n\n## 0.1.20260911\n\n### Changes\n\n- Ship it.\n- And this.\n'), changelog);
  assert.ok(changelog.includes('## 0.1.24'), 'older entries are kept');
  assert.equal(JSON.parse(await readFile(join(root, 'apps', 'synthsr', 'package.json'), 'utf8')).version, '0.3.20260911');
  assert.equal(JSON.parse(await readFile(join(root, 'packages', 'synthsr', 'package.json'), 'utf8')).version, '0.3.20260911');
  assert.match(await readFile(join(root, 'exes', 'synthsr', 'Cargo.toml'), 'utf8'), /^version = "0\.3\.20260911"$/m);
  assert.match(await readFile(join(root, 'exes', 'synthsr', 'Cargo.toml'), 'utf8'), /ort = \{ version = "=2\.0\.0" \}/, 'dependency versions untouched');
  assert.match(await readFile(join(root, 'exes', 'synthsr', 'Cargo.lock'), 'utf8'), /version = "0\.3\.20260911"/);
  assert.deepEqual(await embeddedVersionMismatches(await workspacePackages(root), root), []);
});

test('every embedded version site in the real repo resolves', async () => {
  for (const [appId, sites] of Object.entries(EMBEDDED_VERSION_SITES)) {
    for (const site of sites) {
      const text = await readFile(join(repoRoot, site.file), 'utf8');
      assert.ok(site.pattern.test(text), `${appId}: ${site.file} matches its version pattern`);
    }
  }
  // Sync is a no-op when versions already agree.
  const pkg = [...packages.values()].find((item) => item.id === 'zarro');
  assert.deepEqual(await syncEmbeddedVersions('zarro', pkg.manifest.version), []);
});
