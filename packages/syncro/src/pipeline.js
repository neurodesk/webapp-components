import {readVolume,writeVolume,gaussian} from '../../synthsr/src/index.js';
import * as nifti from 'nifti-reader-js';
export function asBuffer(bytes) {return bytes instanceof ArrayBuffer?bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}
// Validate annotations before the shared scalar reader converts to float32.
// Otherwise uint32/float64 categories could round silently into a valid label.
export function readAdditional(buffer,type='image') {
  buffer=asBuffer(buffer);
  if(type==='image')return readVolume(buffer);
  if(nifti.isCompressed(buffer))buffer=nifti.decompress(buffer);
  const volume=readVolume(buffer),header=nifti.readHeader(buffer);
  const formats={2:['getUint8',1],4:['getInt16',2],8:['getInt32',4],16:['getFloat32',4],64:['getFloat64',8],256:['getInt8',1],512:['getUint16',2],768:['getUint32',4]};
  const [method,stride]=formats[header.datatypeCode],raw=new DataView(nifti.readImage(header,buffer));
  const slope=header.scl_slope||1,intercept=header.scl_slope?header.scl_inter:0;
  for(let i=0;i<volume.data.length;i++) {
    const value=raw[method](i*stride,header.littleEndian)*slope+intercept;
    if(type==='binary'&&value!==0&&value!==1)throw new Error('Binary lesion maps must contain only 0 and 1.');
    if(type==='labels'&&(!Number.isInteger(value)||value<0||Math.fround(value)!==value))throw new Error('Label images require nonnegative integer values representable in float32.');
  }
  return volume;
}
export function sameGeometry(a,b) {
  return a.dims.every((d,i)=>d===b.dims[i])&&a.affine.every((r,i)=>r.every((v,j)=>Math.abs(v-b.affine[i][j])<=0.01));
}
export function prepareAdditional(volume,type) {
  if(!['image','binary','labels'].includes(type))throw new Error('Accompanying input type must be image, binary or labels.');
  if(type==='labels'&&volume.data.some(v=>!Number.isInteger(v)||v<0||v>16777216))throw new Error('Label images require nonnegative integer values representable in float32.');
  if(type!=='binary')return volume;
  if(volume.data.some(v=>v!==0&&v!==1))throw new Error('Binary lesion maps must contain only 0 and 1.');
  const sigmas=[0,1,2].map(a=>3/(2*Math.sqrt(2*Math.log(2)))/Math.hypot(...volume.affine.slice(0,3).map(r=>r[a])));
  return {...volume,data:gaussian(volume.data,volume.dims,sigmas)};
}
export function thresholdBinary(volume) {
  let min=Infinity,max=-Infinity;for(const v of volume.data){min=Math.min(min,v);max=Math.max(max,v);}
  const threshold=(min+max)/2;
  return {...volume,data:Uint8Array.from(volume.data,v=>max===min?(v>0?1:0):(v>=threshold?1:0))};
}

// Inference and filesystem/runtime ownership stay in injected adapters.
export async function runSyncro({input,additional=[],template,synthesize,extractBrain,registration,brainExtractor='synthstrip',ct=false,onProgress=()=>{},onStage=()=>{}}) {
  if(!['mindgrab','synthstrip'].includes(brainExtractor))throw new Error('Brain extractor must be mindgrab or synthstrip.');
  const start=performance.now(),timings={},outputs={},provenance={version:'0.1.4',ct,stages:{}};
  const volume=readVolume(asBuffer(input)),fixed=readVolume(asBuffer(template));
  const accompanying=additional.map((item,i)=>{
    const v=readAdditional(item.buffer,item.type||'image');
    if(!sameGeometry(volume,v))throw new Error(`Accompanying image ${i+1} must match the anatomical image's dimensions and affine.`);
    return {...item,volume:prepareAdditional(v,item.type||'image'),index:i};
  });
  async function stage(name,fn) {
    onProgress(name,0);const t=performance.now();const result=await fn();timings[name]=(performance.now()-t)/1000;
    await onStage(name,result);return result;
  }
  const sr=await stage('synthsr',()=>synthesize({buffer:asBuffer(input),ct,onProgress:(v,m)=>onProgress('synthsr',v,m)}));
  outputs['synthetic-t1.nii']=new Uint8Array(sr.buffer);provenance.stages.synthsr=sr.provenance;
  const extractorName=brainExtractor==='mindgrab'?'MindGrab':'SynthStrip';
  const strip=await stage(brainExtractor,()=>extractBrain({volume:readVolume(sr.buffer),onProgress:(v,m)=>onProgress(brainExtractor,v,m)}));
  outputs['synthetic-brain.nii']=new Uint8Array(writeVolume(strip.brain,extractorName+' synthetic brain'));
  outputs['brain-mask.nii']=new Uint8Array(writeVolume(strip.mask,extractorName+' brain mask'));
  provenance.brainExtractor=brainExtractor;provenance.stages[brainExtractor]=strip.provenance;
  const reg=await stage('registration',()=>registration.register({fixed:writeVolume(fixed,'MNI template'),moving:outputs['synthetic-brain.nii']}));
  try {
    outputs['warped-synthetic-brain.nii.gz']=reg.warped;
    for(const [name,bytes]of Object.entries(reg.transforms))outputs[name]=bytes;
    outputs['warped-original.nii.gz']=await stage('resampling',()=>registration.apply({registration:reg,moving:writeVolume(volume,'Acquired input'),fill:volume.data.reduce((a,b)=>Math.min(a,b),Infinity)}));
    for(const item of accompanying) {
      onProgress('resampling',(item.index+1)/(accompanying.length+1),`Warping accompanying image ${item.index+1}…`);
      const warped=registration.apply({registration:reg,moving:writeVolume(item.volume,'Accompanying input'),interpolation:item.type==='labels'?'nearest':'linear',fill:item.volume.data.reduce((a,b)=>Math.min(a,b),Infinity)});
      const name=`warped-${item.index+1}-${item.type||'image'}`;
      outputs[name+(item.type==='binary'?'.nii':'.nii.gz')]=item.type==='binary'?new Uint8Array(writeVolume(thresholdBinary(readVolume(asBuffer(warped))),'Warped binary lesion')):warped;
    }
    provenance.stages.registration={engine:'ANTs 2.6.2',method:'SyN',seed:42,precision:'float',threads:1};
    provenance.additional=accompanying.map(item=>({name:item.name||`image-${item.index+1}`,type:item.type||'image',policy:item.type==='binary'?'3mm FWHM, linear warp, midpoint threshold':item.type==='labels'?'nearest':'linear'}));
    provenance.timings=timings;provenance.totalSeconds=(performance.now()-start)/1000;
    provenance.outputSpace={dims:fixed.dims,affine:fixed.affine};
    provenance.resamplingDatatype='float32';provenance.synthetic=true;
    outputs['provenance.json']=new TextEncoder().encode(JSON.stringify(provenance,null,2)+'\n');
    onProgress('complete',1,'Normalization complete');return {outputs,provenance};
  } finally {registration.release(reg);}
}
