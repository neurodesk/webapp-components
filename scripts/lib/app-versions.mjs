// Date-based app versioning: every app is versioned MAJOR.MINOR.YYYYMMDD, the
// patch being the release date (SynthSR's scheme). Changesets still describe
// what changed; this module turns them into versions, changelog entries and
// synchronised embedded version strings.
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { repoRoot } from './apps-registry.mjs';

export const DATE_VERSION = /^(\d+)\.(\d+)\.(\d{8})$/;

export function releaseDate(now = new Date()) {
  return now.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Next MAJOR.MINOR.YYYYMMDD for a bump ('patch' | 'minor' | 'major'). */
export function nextVersion(current, bump, date) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!match) throw new Error(`Cannot derive a date version from '${current}'`);
  let [major, minor] = [Number(match[1]), Number(match[2])];
  if (bump === 'major') { major += 1; minor = 0; }
  else if (bump === 'minor') minor += 1;
  else if (bump !== 'patch') throw new Error(`Unknown bump '${bump}'`);
  return `${major}.${minor}.${date}`;
}

/** Parse `.changeset/*.md`: frontmatter of "package": bump lines, then a summary. */
export function parseChangeset(text, name) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${name}: missing frontmatter`);
  const releases = [];
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const entry = /^"?([^"]+)"?\s*:\s*(patch|minor|major)\s*$/.exec(line.trim());
    if (!entry) throw new Error(`${name}: unreadable release line '${line}'`);
    releases.push({ name: entry[1], bump: entry[2] });
  }
  return { name, releases, summary: match[2].trim() };
}

export async function readChangesets(directory = join(repoRoot, '.changeset')) {
  const names = (await readdir(directory)).filter((file) => file.endsWith('.md') && file !== 'README.md').sort();
  return Promise.all(names.map(async (file) => parseChangeset(await readFile(join(directory, file), 'utf8'), file)));
}

/** Workspace package name → directory, for apps and packages. */
export async function workspacePackages(root = repoRoot) {
  const packages = new Map();
  for (const group of ['apps', 'packages']) {
    for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(root, group, entry.name);
      try {
        const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        packages.set(manifest.name, { name: manifest.name, directory, group, manifest, id: entry.name });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return packages;
}

// Packages whose version follows an app's version (they ship inside it).
export const LINKED_PACKAGES = Object.freeze({ '@neurodesk/synthsr': 'synthsr', '@neurodesk/syncro': 'syncro' });

/**
 * Plan the release from changesets. Returns the new version per app package
 * and the summaries for its changelog. Only apps get date versions; shared
 * packages keep semver and are bumped by changesets as before.
 */
export function planRelease(changesets, packages, { date, sameDay = false } = {}) {
  const bumps = new Map();
  const summaries = new Map();
  const rank = { patch: 0, minor: 1, major: 2 };
  for (const changeset of changesets) {
    for (const { name, bump } of changeset.releases) {
      const pkg = packages.get(name);
      if (!pkg) throw new Error(`${changeset.name}: unknown workspace package '${name}'`);
      if (!bumps.has(name) || rank[bump] > rank[bumps.get(name)]) bumps.set(name, bump);
      if (!summaries.has(name)) summaries.set(name, []);
      summaries.get(name).push(changeset.summary);
    }
  }
  const plan = [];
  for (const [name, bump] of bumps) {
    const pkg = packages.get(name);
    if (pkg.group !== 'apps') continue;
    const current = pkg.manifest.version;
    const version = nextVersion(current, bump, date);
    if (version === current && !sameDay) {
      throw new Error(`${name} is already at ${current}; release again tomorrow, bump minor, or pass --same-day to republish this version`);
    }
    plan.push({ name, id: pkg.id, directory: pkg.directory, current, version, bump, summaries: summaries.get(name) });
  }
  return plan.sort((a, b) => a.id.localeCompare(b.id));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function prependChangelog(existing, id, version, summaries) {
  const entry = `## ${version}\n\n### Changes\n\n${summaries.map((summary) => `- ${summary.replace(/\n+/g, ' ')}`).join('\n')}\n`;
  if (!existing) return `# ${id}\n\n${entry}`;
  const heading = /^# .*\n/.exec(existing);
  if (!heading) return `# ${id}\n\n${entry}\n${existing}`;
  const body = existing.slice(heading[0].length).replace(/^\n+/, '');
  if (body.startsWith(`## ${version}\n`)) {
    // Same-day republish: merge the new summaries into the existing entry.
    const [head, ...rest] = body.split(/\n(?=## )/);
    const merged = `${head.trimEnd()}\n${summaries.map((summary) => `- ${summary.replace(/\n+/g, ' ')}`).join('\n')}\n`;
    return `${heading[0]}\n${[merged, ...rest].join('\n')}`;
  }
  return `${heading[0]}\n${entry}\n${body}`;
}

/** Apply a plan: package.json versions, linked packages, changelogs, embedded version sites. */
export async function applyRelease(plan, packages, { root = repoRoot } = {}) {
  const written = [];
  for (const item of plan) {
    const manifestPath = join(item.directory, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.version = item.version;
    await writeJson(manifestPath, manifest);
    written.push(manifestPath);
    const changelogPath = join(item.directory, 'CHANGELOG.md');
    const existing = await readFile(changelogPath, 'utf8').catch(() => '');
    await writeFile(changelogPath, prependChangelog(existing, item.id, item.version, item.summaries));
    written.push(changelogPath);
    for (const [linked, appId] of Object.entries(LINKED_PACKAGES)) {
      if (appId !== item.id) continue;
      const pkg = packages.get(linked);
      if (!pkg) continue;
      const linkedPath = join(pkg.directory, 'package.json');
      const linkedManifest = JSON.parse(await readFile(linkedPath, 'utf8'));
      linkedManifest.version = item.version;
      await writeJson(linkedPath, linkedManifest);
      written.push(linkedPath);
    }
    written.push(...await syncEmbeddedVersions(item.id, item.version, root));
  }
  return written;
}

/**
 * Version strings that live outside package.json. Each app that embeds its
 * version registers a site here; test/app-versions.test.mjs checks they agree.
 */
export const EMBEDDED_VERSION_SITES = Object.freeze({
  musclemap: [
    { file: 'apps/musclemap/model-sources/release.json', pattern: /("appVersion":\s*")[^"]+(")/, replace: '$1{version}$2' },
    { file: 'apps/musclemap/model-sources/release.json', pattern: /("targetAppVersion":\s*")[^"]+(")/, replace: '$1{version}$2' },
    { file: 'apps/musclemap/web/js/app/model-catalog.generated.js', pattern: /(export const APP_VERSION = ")[^"]+(")/, replace: '$1{version}$2' },
    { file: 'apps/musclemap/web/js/app/model-catalog.generated.js', pattern: /(export const TARGET_APP_VERSION = ")[^"]+(")/, replace: '$1{version}$2' },
  ],
  zarro: [
    { file: 'apps/zarro/src/config.js', pattern: /(version: ')[^']+(')/, replace: '$1{version}$2' },
  ],
  synthsr: [
    { file: 'exes/synthsr/Cargo.toml', pattern: /(^\[package\][\s\S]*?^version = ")[^"]+(")/m, replace: '$1{version}$2' },
    { file: 'exes/synthsr/Cargo.lock', pattern: /(name = "synthsr"\nversion = ")[^"]+(")/, replace: '$1{version}$2' },
  ],
});

export async function syncEmbeddedVersions(appId, version, root = repoRoot) {
  const written = [];
  for (const site of EMBEDDED_VERSION_SITES[appId] ?? []) {
    const path = join(root, site.file);
    const text = await readFile(path, 'utf8').catch(() => null);
    if (text === null) continue;
    const next = text.replace(site.pattern, site.replace.replace('{version}', version));
    if (next === text && !site.pattern.test(text)) throw new Error(`${site.file}: version site not found for ${appId}`);
    if (next !== text) { await writeFile(path, next); written.push(path); }
  }
  return written;
}

/** Every embedded version string that disagrees with its app's package.json. */
export async function embeddedVersionMismatches(packages, root = repoRoot) {
  const mismatches = [];
  for (const [appId, sites] of Object.entries(EMBEDDED_VERSION_SITES)) {
    const pkg = [...packages.values()].find((item) => item.group === 'apps' && item.id === appId);
    if (!pkg) continue;
    for (const site of sites) {
      const text = await readFile(join(root, site.file), 'utf8').catch(() => null);
      if (text === null) continue;
      const match = site.pattern.exec(text);
      const found = match ? text.slice(match.index + match[1].length, match.index + match[0].length - match[2].length) : null;
      if (found !== pkg.manifest.version) mismatches.push(`${site.file}: ${found ?? 'missing'} ≠ ${appId} ${pkg.manifest.version}`);
    }
  }
  for (const [linked, appId] of Object.entries(LINKED_PACKAGES)) {
    const pkg = packages.get(linked);
    const app = [...packages.values()].find((item) => item.group === 'apps' && item.id === appId);
    if (pkg && app && pkg.manifest.version !== app.manifest.version) mismatches.push(`${linked} ${pkg.manifest.version} ≠ ${appId} ${app.manifest.version}`);
  }
  return mismatches;
}

export async function removeChangesets(changesets, directory = join(repoRoot, '.changeset')) {
  await Promise.all(changesets.map((changeset) => rm(join(directory, changeset.name), { force: true })));
}

export function loadYaml(text) { return parse(text); }
