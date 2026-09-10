import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowsDirectory = new URL('../.github/workflows/', import.meta.url);
const node24Actions = new Map([
  ['actions/cache', 'v6'],
  ['actions/checkout', 'v7'],
  ['actions/configure-pages', 'v6'],
  ['actions/deploy-pages', 'v5'],
  ['actions/setup-node', 'v7'],
  ['actions/setup-python', 'v7'],
  ['actions/upload-artifact', 'v7'],
  ['actions/download-artifact', 'v8'],
  ['actions/upload-pages-artifact', 'v5'],
  ['pnpm/action-setup', 'v6'],
]);

test('active workflows use Node 24 action runtimes', async () => {
  const workflowNames = (await readdir(workflowsDirectory)).filter((name) =>
    name.endsWith('.yml') || name.endsWith('.yaml')
  );
  const seen = new Set();

  for (const workflowName of workflowNames) {
    const workflow = await readFile(new URL(workflowName, workflowsDirectory), 'utf8');
    for (const match of workflow.matchAll(/uses:\s+([^\s@]+)@([^\s#]+)(?:\s+#\s*(v\d+))?/g)) {
      const [, action, revision, pinnedVersion] = match;
      const expectedVersion = node24Actions.get(action);
      if (!expectedVersion) continue;
      seen.add(action);
      assert.equal(
        pinnedVersion || revision,
        expectedVersion,
        `${workflowName} must use ${action}@${expectedVersion}`,
      );
    }
  }

  assert.deepEqual(seen, new Set(node24Actions.keys()));
});
