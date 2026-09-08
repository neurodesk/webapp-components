import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readVolume, writeVolume, prepare, finish, flipInput } from '../src/volume.js';
const fixtures=new URL('./fixtures/',import.meta.url);
const buffer=async(name)=>{const b=await readFile(new URL(name,fixtures));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const records=JSON.parse(await readFile(new URL('spatial.json',fixtures)));
for(const item of records) test(`Python parity: ${item.name} geometry, intensities, output`,async()=>{
  const prep=prepare(readVolume(await buffer(item.name+'.nii.gz')),{ct:item.ct});
  assert.deepEqual(prep.paddedDims,item.paddedDims);
  const expected=new Float32Array(await buffer(item.name+'-input.bin'));
  let max=0;for(let i=0;i<expected.length;i++)max=Math.max(max,Math.abs(expected[i]-prep.input[i]));
  assert.ok(max<2e-6,`preprocessing error ${max}`);
  const output=finish(Float32Array.from(prep.input,v=>v*128),prep);
  const reference=readVolume(await buffer(item.name+'-output.nii.gz'));
  assert.deepEqual(output.dims,reference.dims);
  for(let r=0;r<3;r++)for(let c=0;c<4;c++)assert.ok(Math.abs(output.affine[r][c]-reference.affine[r][c])<2e-5);
  let mismatch=0;for(let i=0;i<output.data.length;i++){assert.ok(Math.abs(output.data[i]-reference.data[i])<=1);mismatch+=output.data[i]!==reference.data[i];}
  assert.ok(mismatch/output.data.length<0.002,`byte mismatches: ${mismatch}`);
  const reread=readVolume(writeVolume(output));assert.deepEqual(reread.data,Float32Array.from(output.data));
});
test('left-right augmentation is an involution',()=>{const a=Float32Array.from({length:24},(_,i)=>i);assert.deepEqual(flipInput(flipInput(a,[2,3,4]),[2,3,4]),a);});
test('reject corrupt, non-finite and 4D inputs',()=>{
  assert.throws(()=>readVolume(new ArrayBuffer(10)));
  const volume={dims:[2,2,2],data:new Float32Array(8),affine:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]};
  volume.data[0]=NaN;assert.throws(()=>readVolume(writeVolume(volume)),/non-finite/);
  volume.data.fill(0);assert.throws(()=>prepare(volume),/variation/);
  const b=writeVolume(volume),v=new DataView(b);v.setInt16(40,4,true);v.setInt16(48,2,true);assert.throws(()=>readVolume(b),/3D/);
});
test('NIfTI scaling and meter units are applied once',()=>{
 const b=writeVolume({dims:[2,2,2],data:Float32Array.from({length:8},(_,i)=>i),affine:[[.001,0,0,.01],[0,.002,0,-.02],[0,0,.003,0],[0,0,0,1]]});
 const v=new DataView(b);v.setUint8(123,1);v.setFloat32(112,2,true);v.setFloat32(116,-4,true);
 const r=readVolume(b);assert.equal(r.data[3],2);assert.ok(Math.abs(r.affine[0][0]-1)<1e-6);assert.ok(Math.abs(r.affine[0][3]-10)<1e-6);
});
