import { readFile, writeFile, mkdir, rename, link, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { randomUUID } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { runSynthsr } from './pipeline.js';
import { resolveModel } from './model.js';
export { resolveModel, manifest, defaultCacheDir } from './model.js';
export function defaultThreads() {
  const allocated=Number(process.env.SLURM_CPUS_PER_TASK);
  return Number.isSafeInteger(allocated)&&allocated>0 ? allocated : Math.min(4,availableParallelism());
}
const fileStat=async path=>{try{return await stat(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}};

export async function synthesize({input,output,modelPath,cacheDir,offline=false,threads=defaultThreads(),device='cpu',
  ct=false,tiled=false,flip=true,sharpen=true,force=false,onProgress=()=>{}}={}) {
  if(!input)throw new Error('An input NIfTI path is required.');
  if(!['cpu','cuda'].includes(device))throw new Error('Device must be cpu or cuda.');
  if(!Number.isSafeInteger(threads)||threads<1)throw new Error('Threads must be a positive integer.');
  input=resolve(input);output=resolve(output || input.replace(/\.nii(\.gz)?$/i,'')+`_synthsr${tiled?'_tiled':''}.nii.gz`);
  if(!/\.nii(\.gz)?$/i.test(output))throw new Error('Output must end with .nii or .nii.gz.');
  const reportPath=output.replace(/\.nii(\.gz)?$/i,'.json');
  const inputStat=await stat(input);
  for(const path of [output,reportPath]) {
    const existing=await fileStat(path);
    if(path===input || (existing && existing.dev===inputStat.dev && existing.ino===inputStat.ino))throw new Error('Output must not overwrite the input image.');
    if(existing&&!force)throw new Error(`Output already exists: ${path}. Use --force to replace results.`);
  }
  const bytes=await readFile(input);
  // Native bindings are loaded only by this Node adapter, never by the browser API.
  const ort=await import('onnxruntime-node');
  const result=await runSynthsr({
    buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
    options:{ct,tiled,flip,sharpen,backend:device},Tensor:ort.Tensor,onProgress,
    loadModel:()=>resolveModel({modelPath,cacheDir,offline,onProgress}),
    createSession:(model)=>ort.InferenceSession.create(model,{
      executionProviders:[device],graphOptimizationLevel:'all',intraOpNumThreads:threads,interOpNumThreads:1,
      ...(device==='cuda'?{extra:{session:{disable_cpu_ep_fallback:'1'}}}:{}),
    }),
    runtime:{app:'SynthSR CLI 0.1.0',onnxRuntime:ort.env.versions.node,threads},
  });
  result.provenance.input=input;result.provenance.output=output;
  const image=output.toLowerCase().endsWith('.gz')?await promisify(gzip)(Buffer.from(result.buffer)):Buffer.from(result.buffer);
  const outputs=[[output,image],[reportPath,JSON.stringify(result.provenance,null,2)+'\n']];
  const temporary=[],published=[];
  try {
    for(const [path,data] of outputs) {
      await mkdir(dirname(path),{recursive:true});
      const temp=path+'.'+randomUUID()+'.partial';temporary.push(temp);
      await writeFile(temp,data,{flag:'wx'});
    }
    for(let i=0;i<outputs.length;i++) {
      if(force)await rename(temporary[i],outputs[i][0]);
      else await link(temporary[i],outputs[i][0]); // atomic no-clobber publication
      published.push(outputs[i][0]);
    }
  } catch(error) {
    if(!force)await Promise.all(published.map(path=>rm(path,{force:true})));
    throw error;
  } finally { await Promise.all(temporary.map(path=>rm(path,{force:true}))); }
  return {output,reportPath,provenance:result.provenance};
}
