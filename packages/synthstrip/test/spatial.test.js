import test from 'node:test';import assert from 'node:assert/strict';
import {cleanMask} from '../src/index.js';
test('fills a hole even when there is only one connected component',()=>{
 const d=[7,7,7],m=new Uint8Array(343);for(let z=1;z<6;z++)for(let y=1;y<6;y++)for(let x=1;x<6;x++)m[x+7*(y+7*z)]=1;
 m[3+7*(3+7*3)]=0;const r=cleanMask(m,d);assert.equal(r.reduce((a,b)=>a+b),125);assert.equal(r[0],0);
});
test('diagonal islands are not connected to the main brain component',()=>{
 const m=new Uint8Array(125);m[1+5*(1+5*1)]=1;m[2+5*(1+5*1)]=1;m[3+5*(2+5*2)]=1;
 assert.equal(cleanMask(m,[5,5,5]).reduce((a,b)=>a+b),2);
});
