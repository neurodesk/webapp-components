import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readVolume,writeVolume} from '../../synthsr/src/index.js';
import {prepareStrip,runSynthstrip} from '../../synthstrip/src/index.js';
const require=createRequire(new URL('../../synthsr/package.json',import.meta.url));
const ort=require('onnxruntime-node');
const [input,modelPath,out]=process.argv.slice(2);
if(!out)throw new Error('Usage: run-strip.mjs input.nii.gz model.onnx output-directory');
await mkdir(out,{recursive:true});
const bytes=await readFile(input),volume=readVolume(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const prep=prepareStrip(volume);
await writeFile(out+'/conformed.f32',Buffer.from(prep.input.buffer));
await writeFile(out+'/conformed.json',JSON.stringify({shape:prep.modelDims,perm:prep.perm,flip:prep.flip,lo:prep.lo,shift:prep.shift}));
const model=await readFile(modelPath),hash=createHash('sha256').update(model).digest('hex');
const started=performance.now();
const result=await runSynthstrip({volume,Tensor:ort.Tensor,loadModel:async()=>({bytes:model,hash}),
  createSession:bytes=>ort.InferenceSession.create(bytes,{executionProviders:['cpu'],intraOpNumThreads:4,interOpNumThreads:1}),
  onProgress:(p,m)=>console.log(m)});
for(const key of ['brain','mask','distance'])await writeFile(out+'/'+key+'.nii',Buffer.from(writeVolume(result[key],'SynthStrip '+key)));
await writeFile(out+'/report.json',JSON.stringify({...result.provenance,seconds:(performance.now()-started)/1000},null,2));
console.log('Finished',out);
