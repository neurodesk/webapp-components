import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
test('bundled MNI template matches the container, including HTTP-decoded bytes',async()=>{
 const bytes=await readFile(new URL('../../../packages/syncro/data/MNI152_T1_1mm_brain.nii.gz',import.meta.url));
 const sha=b=>createHash('sha256').update(b).digest('hex');
 assert.equal(sha(bytes),'32d5be33460f995a5d305507053c8862c823d9ca6bfb543381308df14590f212');
 assert.equal(sha(gunzipSync(bytes)),'18576c0190c0f6496f3d4a6bf40cfd6e9cddb4b6eaa8517bb0af2b88ff67c0c5');
});
