import assert from 'node:assert/strict';
import test from 'node:test';
import {checkInstallation} from '../src/node.js';

test('installation check loads the native runtime and external assets',async()=>{
  const result=await checkInstallation({
    registrationModule:new URL('../../registration/wasm/syncro-registration.mjs',import.meta.url),
    registrationWasm:new URL('../../registration/wasm/syncro-registration.wasm',import.meta.url),
  });
  assert.equal(result.platform,process.platform);
  assert.equal(result.arch,process.arch);
  assert.equal(result.node,process.version);
  assert.equal(result.executable,process.execPath);
  assert.equal(result.onnxRuntime,'1.29.0');
  assert.equal(result.templateSha256,'32d5be33460f995a5d305507053c8862c823d9ca6bfb543381308df14590f212');
  assert.equal(result.registrationWasmSha256,'23cb91e0a9363cce16581d459ee52dabbf35538a2ad4ed565d2d83cd4a116348');
});
