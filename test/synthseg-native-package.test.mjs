import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const verifier = resolve('exes/synthseg/scripts/verify_macos_pkg.sh');

async function packageFixture(t) {
  const directory = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'synthseg-package-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'tools');
  await mkdir(bin);
  const executable = async (name, source) => {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/sh\nset -eu\n${source}\n`);
    await chmod(path, 0o755);
    return path;
  };
  const payload = await executable('synthseg', 'echo "model checksum verified"; exit "${SELF_CHECK_EXIT:-0}"');
  await executable('pkgutil', `
case "$1" in
  --check-signature)
    if [ "\${UNSIGNED:-0}" = 1 ]; then
      echo 'Status: no signature'
      exit 1
    fi
    echo 'Status: signed by a developer certificate'
    echo "Developer ID Installer: Test (\${SIGNING_TEAM:-68BQDQS28R})"
    ;;
  --expand-full)
    mkdir -p "$3/usr/local/bin"
    cp "$FAKE_PAYLOAD" "$3/usr/local/bin/synthseg"
    ;;
esac`);
  await executable('codesign', `
if [ "$1" = -dv ]; then
  echo "TeamIdentifier=\${SIGNING_TEAM:-68BQDQS28R}"
  echo 'Authority=Developer ID Application: Test'
fi`);
  await executable('otool', `
if [ "$1" = -L ]; then
  echo "$2:"
  echo ' /usr/lib/libSystem.B.dylib (compatibility version 1.0.0)'
fi`);
  const pkg = join(directory, 'synthseg.pkg');
  await writeFile(pkg, 'test package');
  return (environment = {}, args = []) => spawnSync('sh', [verifier, pkg, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: directory,
      FAKE_PAYLOAD: payload,
      EXPECTED_TEAM_ID: '68BQDQS28R',
      ...environment,
    },
  });
}

test('SynthSeg package verification enforces the signing team and explicit ad-hoc mode', async (t) => {
  const verify = await packageFixture(t);
  const valid = verify();
  assert.equal(valid.status, 0, valid.stderr);
  assert.notEqual(verify({ SIGNING_TEAM: 'AAAAAAAAAA' }).status, 0);
  assert.notEqual(verify({ UNSIGNED: '1' }).status, 0);
  const adhoc = verify({ UNSIGNED: '1' }, ['--allow-adhoc']);
  assert.equal(adhoc.status, 0, adhoc.stderr);
});

test('SynthSeg package verification propagates a failed offline self-check', async (t) => {
  const verify = await packageFixture(t);
  const failed = verify({ SELF_CHECK_EXIT: '7' });
  assert.equal(failed.status, 7);
  assert.doesNotMatch(failed.stdout, /Verified .*\.pkg/);
});
