import {readFile,writeFile} from 'node:fs/promises';
import createModule from '../../registration/wasm/syncro-registration.mjs';
import {createRegistration} from '../../registration/src/index.js';
import {readVolume,writeVolume} from '../../synthsr/src/index.js';
import {asBuffer,prepareAdditional,thresholdBinary} from '../src/pipeline.js';
const w=process.argv[2];
const engine=await createRegistration({createModule,wasmBinary:await readFile(new URL('../../registration/wasm/syncro-registration.wasm',import.meta.url)),onLog:console.log});
const transforms={};for(const name of ['0GenericAffine.mat','1Warp.nii.gz','1InverseWarp.nii.gz'])transforms[name]=await readFile(w+'/reference/transform-'+name);
const reg=engine.importTransforms({fixed:writeVolume(readVolume(asBuffer(await readFile(w+'/reference/template.nii.gz')))),transforms});
try{for(const type of ['binary','labels']){
 const volume=prepareAdditional(readVolume(asBuffer(await readFile(w+'/'+type+'.nii.gz'))),type);
 if(type==='binary')await writeFile(w+'/web-binary-smoothed.nii',new Uint8Array(writeVolume(volume)));
 let out=engine.apply({registration:reg,moving:writeVolume(volume),interpolation:type==='labels'?'nearest':'linear'});
 if(type==='binary')out=new Uint8Array(writeVolume(thresholdBinary(readVolume(asBuffer(out)))));
 await writeFile(w+'/web-'+type+(type==='binary'?'.nii':'.nii.gz'),out);
}}finally{engine.release(reg);}
