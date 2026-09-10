import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createSyncroRelease} from '../release.mjs';

const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
const appPackage=JSON.parse(await readFile(new URL('../../../apps/syncro/package.json',import.meta.url)));

test('portable release names and commands derive from the package version',()=>{
  const release=createSyncroRelease(packageJson.version);
  assert.equal(release.tag,`syncro-v${packageJson.version}`);
  assert.deepEqual(Object.keys(release.targets),['windows-x64','linux-x64']);
  assert.equal(release.targets['windows-x64'].archiveName,`syncro-${packageJson.version}-windows-x64.zip`);
  assert.equal(release.targets['linux-x64'].archiveName,`syncro-${packageJson.version}-linux-x64.tar.gz`);
  for(const target of Object.values(release.targets)) {
    assert.equal(target.checksumName,`${target.archiveName}.sha256`);
    assert.equal(target.validationName,`${target.archiveName}.validation.txt`);
    assert.equal(target.url,`https://github.com/neurodesk/webapps/releases/download/${release.tag}/${target.archiveName}`);
    assert.equal(target.checksumUrl,`${target.url}.sha256`);
    assert.match(target.run,/syncro(?:\.exe)? input\.nii\.gz results --threads 4/);
  }
});

test('portable release rejects unsafe versions and app version drift',()=>{
  assert.throws(()=>createSyncroRelease('../latest'),/version/i);
  assert.equal(appPackage.version,packageJson.version);
});
