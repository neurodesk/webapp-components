import test from 'node:test';import assert from 'node:assert/strict';import {synArguments} from '../src/index.js';
test('invalid seeds are rejected before starting registration',()=>{for(const seed of [NaN,0,-1,1.5])assert.throws(()=>synArguments('f','m','o',seed),/seed/);});
