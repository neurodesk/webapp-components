import test from 'node:test';import assert from 'node:assert/strict';
import {sameGeometry,prepareAdditional,thresholdBinary,runSyncro,readAdditional} from '../src/pipeline.js';
import {writeVolume} from '../../synthsr/src/index.js';
const affine=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],v={dims:[5,5,5],affine,data:new Float32Array(125)};
test('matching dimensions cannot hide a different physical frame',()=>{
 const moved={...v,affine:affine.map(r=>r.slice())};moved.affine[0][3]=1;assert.equal(sameGeometry(v,moved),false);
});
test('empty lesion remains empty after propagation threshold',()=>assert.equal(thresholdBinary(v).data.some(Boolean),false));
test('annotation validation rejects values that would silently round during float32 decoding',()=>{
 const encoded=new ArrayBuffer(352+125*8);new Uint8Array(encoded,0,352).set(new Uint8Array(writeVolume(v),0,352));
 const raw=new DataView(encoded);raw.setInt16(70,64,true);raw.setInt16(72,64,true);
 raw.setFloat64(352,16777217,true);assert.throws(()=>readAdditional(encoded,'labels'),/Label images/);
 raw.setFloat64(352,1.000000001,true);assert.throws(()=>readAdditional(encoded,'binary'),/0 and 1/);
});
test('categorical labels never receive lesion smoothing',()=>{
 const labels={...v,data:v.data.slice()};labels.data[62]=3;assert.equal(prepareAdditional(labels,'labels'),labels);
 assert.throws(()=>prepareAdditional(labels,'binary'),/0 and 1/);
});
test('geometry errors fail before loading or executing models',async()=>{
 const moved={...v,affine:affine.map(r=>r.slice())};moved.affine[0][3]=2;let called=false;
 await assert.rejects(runSyncro({input:writeVolume(v),template:writeVolume(v),additional:[{buffer:writeVolume(moved)}],synthesize:()=>{called=true;}}),/must match/);
 assert.equal(called,false);
});
