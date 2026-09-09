import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';
import { loadAppsRegistry } from '../scripts/lib/apps-registry.mjs';
import { createAppPlan } from '../scripts/lib/app-plan.mjs';

async function workflow(name) {
  return YAML.parse(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
}

test('routine CI uses the lightweight SCT gate and full inference runs independently', async () => {
  const ci = await workflow('ci');
  const full = await workflow('sct-full-tests');
  const release = await workflow('release');
  const registry = await loadAppsRegistry();
  const entry = createAppPlan(registry, ['apps/spinalcordtoolbox/package.json']).apps.include[0];
  const step = ci.jobs['app-tests'].steps.find(step => step.name === 'Test ${{ matrix.app }}');
  assert.equal(entry.release_test, 'test:release');
  assert.equal(step.env.TEST_SCRIPT, '${{ matrix.release_test }}');
  assert.match(step.run, /run "\$TEST_SCRIPT"/);
  assert.deepEqual(Object.keys(full.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(full.jobs['full-suite']['timeout-minutes'], 240);
  assert.equal(full.jobs['full-suite'].env.SCT_WORKER_TIMEOUT_MINUTES, '30');
  assert.equal(full.concurrency['cancel-in-progress'], false);
  for (const flow of [ci, release]) {
    assert.ok(!JSON.stringify(flow).includes('sct-full-tests'));
  }
});

test('macOS signing is manual, tested and separate from pull-request packages', async () => {
  const flow = await workflow('synthsr-macos');
  assert.deepEqual(flow.permissions, {contents: 'read'});
  assert.equal(flow.jobs.release.if, "github.event_name == 'workflow_dispatch' && inputs.sign_release");
  assert.equal(flow.jobs.release.needs, 'package');
  assert.ok(!JSON.stringify(flow.jobs.package).includes('secrets.'));
  const steps = flow.jobs.release.steps;
  const target = steps.findIndex(step => step.name === 'Check release target');
  const sign = steps.findIndex(step => step.name === 'Sign and notarize installer');
  const publish = steps.findIndex(step => step.name === 'Attach verified release assets');
  assert.ok(target >= 0 && target < sign && sign < publish);
  assert.match(steps[target].run, /isDraft or .isPrerelease/);
  assert.match(steps[target].run, /git rev-parse/);
  assert.match(steps[target].run, /GITHUB_SHA/);
});
