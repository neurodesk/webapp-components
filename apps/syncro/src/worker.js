import {createRegistration} from '@neurodesk/registration';
import {runSyncro} from '../../../packages/syncro/src/pipeline.js';
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const progress=(stage,value,message)=>self.postMessage({type:'progress',stage,value,message});
// A fresh worker per network releases ORT's WebAssembly arena between stages.
function infer(job,onProgress){return new Promise((resolve,reject)=>{
 const child=new Worker(new URL('./inference-worker.js',import.meta.url),{type:'module'});
 const finish=(error,result)=>{child.terminate();error?reject(error):resolve(result);};
 child.onerror=e=>finish(new Error(e.message||'Inference worker failed.'));
 child.onmessage=({data})=>{
  if(data.type==='progress')onProgress(data.value,data.message);
  else if(data.type==='error')finish(new Error(data.message));
  else if(data.type==='result')finish(null,data.result);
 };
 child.postMessage(job);
});}
self.onmessage=async({data:job})=>{
 try {
  if(!self.crossOriginIsolated)throw new Error('Reload this page to enable isolated WebAssembly processing.');
  const templateResponse=await fetch(job.templateURL);if(!templateResponse.ok)throw new Error('Could not load the MNI template.');
  const template=await templateResponse.arrayBuffer();
  // Some static servers mark .nii.gz as Content-Encoding: gzip, so fetch
  // returns the decompressed NIfTI. Both representations are independently pinned.
  const templateHash=await sha(template);
  const templateRepresentations={
   '32d5be33460f995a5d305507053c8862c823d9ca6bfb543381308df14590f212':3219212,
   '18576c0190c0f6496f3d4a6bf40cfd6e9cddb4b6eaa8517bb0af2b88ff67c0c5':14442416,
  };
  if(templateRepresentations[templateHash]!==template.byteLength)throw new Error('MNI template checksum mismatch.');
  let engine;
  const result=await runSyncro({input:await job.input.arrayBuffer(),ct:job.ct,template,
   additional:await Promise.all(job.additional.map(async item=>({name:item.file.name,type:item.type,buffer:await item.file.arrayBuffer()}))),
   synthesize:args=>infer({stage:'synthsr',buffer:args.buffer,ct:job.ct,backend:job.synthsrBackend??'webgpu',modelBase:job.modelBase},args.onProgress),
   extractBrain:args=>infer({stage:'synthstrip',volume:args.volume,modelBase:job.modelBase},args.onProgress),
   registration:{async register(args){
    const {default:createModule}=await import(/* @vite-ignore */ job.registrationURL);
    engine=await createRegistration({createModule,onLog:message=>self.postMessage({type:'log',message})});return engine.register(args);
   },apply:args=>engine.apply(args),release:reg=>engine.release(reg)},onProgress:progress,
  });
  result.provenance.templateHash=await sha(template);result.provenance.inputHash=await sha(await job.input.arrayBuffer());
  result.outputs['provenance.json']=new TextEncoder().encode(JSON.stringify(result.provenance,null,2)+'\n');
  self.postMessage({type:'result',...result},[...new Set(Object.values(result.outputs).map(b=>b.buffer))]);
 }catch(e){self.postMessage({type:'error',message:e.message||String(e)});}
};
