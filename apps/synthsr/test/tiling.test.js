import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTiled } from '../src/tiling.js';

for (const dims of [[128,64,32], [32,128,64], [64,32,160]]) {
  test(`tile extraction and assembly preserve every voxel: ${dims.join('×')}`, async () => {
    const input = Float32Array.from({length:dims.reduce((a,b)=>a*b,1)}, (_,i)=>i+1);
    let calls=0, completed=0;
    const output = await runTiled(input,dims,async (patch,shape)=>{
      calls++;
      assert.deepEqual(shape,dims.map(d=>Math.min(96,d)));
      assert.equal(patch.length,shape.reduce((a,b)=>a*b,1));
      return Float32Array.from(patch,v=>-v);
    },(done,total)=>{assert.equal(done,++completed);assert.ok(done<=total);});
    assert.equal(calls,completed);
    assert.deepEqual(output,Float32Array.from(input,v=>-v));
  });
}
