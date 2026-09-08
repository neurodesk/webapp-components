import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import manifest from '../model.manifest.json' with { type: 'json' };
export { manifest };
const asset=manifest.assets.find(a=>a.filename==='synthsr-v2.onnx');
export const defaultCacheDir=()=>join(process.env.XDG_CACHE_HOME || join(homedir(),'.cache'),'neurodesk','synthsr');
function validate(bytes) {
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(bytes.length!==asset.bytes || hash!==asset.sha256)throw new Error('SynthSR model checksum mismatch. Use the validated synthsr-v2.onnx model.');
  return {bytes,hash};
}
export async function resolveModel({ modelPath, cacheDir=defaultCacheDir(), offline=false, onProgress=()=>{} }={}) {
  const path=modelPath || join(cacheDir,asset.sha256,asset.filename);
  try { return {...validate(await readFile(path)),path}; }
  catch(error) { if(error.code!=='ENOENT')throw error;if(modelPath)throw new Error(`Model file not found: ${path}`); }
  if(offline)throw new Error(`Model is not cached at ${path}. Run "synthsr download-model" on a networked node first, or pass --model /path/synthsr-v2.onnx.`);
  onProgress(.12,'Downloading validated SynthSR model from Hugging Face…');
  const response=await fetch(manifest.base_url+asset.filename,{signal:AbortSignal.timeout(300000)});
  if(!response.ok)throw new Error(`Model download failed (HTTP ${response.status}). Prefetch with synthsr download-model or pass --model.`);
  const chunks=[];let received=0;
  for await(const chunk of response.body) {
    received+=chunk.length;if(received>asset.bytes)throw new Error('Downloaded model exceeds its expected size.');
    chunks.push(chunk);onProgress(.12+.13*received/asset.bytes,`Downloading model · ${(received/1048576).toFixed(1)} MB`);
  }
  const result=validate(Buffer.concat(chunks));
  const directory=join(cacheDir,asset.sha256);await mkdir(directory,{recursive:true});
  const temporary=join(directory,`${asset.filename}.${randomUUID()}.partial`);
  try { await writeFile(temporary,result.bytes,{flag:'wx'});await rename(temporary,path); }
  finally { await rm(temporary,{force:true}); }
  return {...result,path};
}
