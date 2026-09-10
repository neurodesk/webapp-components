#!/usr/bin/env node
// Turn pending changesets into MAJOR.MINOR.YYYYMMDD app versions.
//
//   pnpm release                 apply .changeset/*.md, version apps for today (UTC)
//   pnpm release --dry-run       print the plan without writing
//   pnpm release --same-day      republish an app already versioned for today
//   pnpm release --date 20260101 version for a specific date
//
// Apps get the date version, a CHANGELOG entry, matching linked package
// versions (@neurodesk/synthsr, @neurodesk/syncro) and synchronised embedded
// version sites (MuscleMap model contracts, ZARRo config, SynthSR Cargo).
// Shared packages named in a changeset keep semver and are bumped by
// `changeset version` afterwards.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { repoRoot } from './lib/apps-registry.mjs';
import {
  LINKED_PACKAGES, applyRelease, planRelease, readChangesets, releaseDate, removeChangesets, workspacePackages,
} from './lib/app-versions.mjs';

const run = promisify(execFile);
const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' }, 'same-day': { type: 'boolean' }, date: { type: 'string' } } });
const date = values.date ?? releaseDate();
if (!/^\d{8}$/.test(date)) throw new Error(`--date must be YYYYMMDD, got ${date}`);

const changesets = await readChangesets();
if (!changesets.length) {
  console.log('No changesets to release. Add one with `pnpm changeset`.');
  process.exit(0);
}
const packages = await workspacePackages();
const plan = planRelease(changesets, packages, { date, sameDay: values['same-day'] });
for (const item of plan) console.log(`${item.id}: ${item.current} → ${item.version} (${item.bump})`);
if (!plan.length) console.log('No app releases in the pending changesets.');

// Shared packages that are not linked to an app keep changeset semver.
const shared = new Map();
for (const changeset of changesets) {
  for (const { name, bump } of changeset.releases) {
    if (packages.get(name)?.group === 'packages' && !Object.hasOwn(LINKED_PACKAGES, name)) shared.set(name, bump);
  }
}
if (shared.size) console.log(`Shared packages (semver via changesets): ${[...shared.keys()].join(', ')}`);
if (values['dry-run']) process.exit(0);

const written = await applyRelease(plan, packages, { root: repoRoot });
await removeChangesets(changesets);
if (shared.size) {
  const lines = [...shared].map(([name, bump]) => `"${name}": ${bump}`);
  await writeFile(join(repoRoot, '.changeset', `shared-${date}.md`), `---\n${lines.join('\n')}\n---\n\n${changesets.map((changeset) => changeset.summary).join('\n\n')}\n`);
  await run('pnpm', ['exec', 'changeset', 'version'], { cwd: repoRoot });
}
if (plan.some((item) => item.id === 'musclemap')) {
  await run('node', ['scripts/generate_model_contracts.mjs'], { cwd: join(repoRoot, 'apps', 'musclemap') });
}
await run('pnpm', ['install', '--lockfile-only'], { cwd: repoRoot });
console.log(`Updated ${written.length} files. Review, commit, merge, then dispatch the release-apps workflow.`);
