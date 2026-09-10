import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { nativeDownloads } from '../src/native-release.js';
import { nativeReleaseVersion } from '../scripts/package-plugin.mjs';

const version = '0.2.20260910';
const downloads = nativeDownloads(version);

test('native downloads use the Cargo release tag and platform asset names', () => {
  assert.deepEqual(Object.keys(downloads), ['macos', 'windows', 'linux']);
  assert.equal(downloads.macos.filename, `synthsr-${version}-macos-arm64.pkg`);
  assert.equal(downloads.windows.filename, `synthsr-${version}-windows-x64.zip`);
  assert.equal(downloads.linux.filename, `synthsr-${version}-linux-x64.tar.gz`);
  for (const item of Object.values(downloads)) {
    assert.equal(
      item.url,
      `https://github.com/neurodesk/webapps/releases/download/synthsr-v${version}/${item.filename}`,
    );
  }
});

test('native commands use the Rust CLI positional input and output', () => {
  assert.match(downloads.macos.command, /^synthsr input\.nii\.gz output_synthsr\.nii\.gz/);
  assert.match(downloads.windows.command, /\.\\synthsr\.exe input\.nii\.gz output_synthsr\.nii\.gz/);
  assert.match(downloads.linux.command, /\.\/synthsr input\.nii\.gz output_synthsr\.nii\.gz/);
  for (const item of Object.values(downloads)) {
    assert.doesNotMatch(item.command, /--input|--output/);
  }
});

test('invalid native versions are rejected before links are constructed', () => {
  for (const invalid of ['', 'v0.2.0', '0.2/next', 'latest']) {
    assert.throws(() => nativeDownloads(invalid), /version/i);
  }
});

test('the app build injects the native version from Cargo.toml', async () => {
  const config = await nativeReleaseVersion().config();
  assert.equal(config.define.__SYNTHSR_NATIVE_VERSION__, JSON.stringify(version));
  for (const path of ['../package.json', '../../../packages/synthsr/package.json']) {
    const manifest = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    assert.equal(manifest.version, version);
  }
});
