#!/usr/bin/env node
// Apply pending changesets with UTC date versions for apps and linked packages.
// pnpm release [--dry-run] [--same-day] [--date YYYYMMDD]
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { repoRoot } from './lib/apps-registry.mjs';
import { applyRelease, planRelease } from './lib/app-versions.mjs';

const run = promisify(execFile);
const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean' },
    'same-day': { type: 'boolean' },
    date: { type: 'string' },
  },
});
const release = await planRelease(repoRoot, { date: values.date, sameDay: values['same-day'] });
if (!release.plan.changesets.length) {
  console.log('No changesets to release. Add one with `pnpm changeset`.');
  process.exit(0);
}
for (const item of release.plan.releases) {
  console.log(`${item.name}: ${item.oldVersion} → ${item.newVersion} (${item.type})`);
}
if (values['dry-run']) process.exit(0);

const written = await applyRelease(release);
if (release.plan.releases.some((item) => item.name === 'musclemap' && item.type !== 'none')) {
  await run('node', ['scripts/generate_model_contracts.mjs'], { cwd: join(repoRoot, 'apps', 'musclemap') });
}
await run('pnpm', ['install', '--lockfile-only'], { cwd: repoRoot });
console.log(`Updated ${written.length} files. Review, commit, merge, then dispatch the release-apps workflow.`);
