// Run in a browser on the production SYNcro origin. URLs may point at local
// validation assets or public files; no image data leaves the browser.
export async function validateSynthsrStage({workerURL,inputURL,referenceURL,backend='webgpu',onProgress=()=>{}}) {
  const fetchBytes=async url=>{
    const response=await fetch(url);
    if(!response.ok)throw new Error(`Validation download failed: ${response.status}`);
    return response.arrayBuffer();
  };
  const uint8Nifti=async buffer=>{
    if(new Uint8Array(buffer)[0]===31)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const header=new DataView(buffer),little=header.getInt32(0,true)===348;
    if(header.getInt32(0,little)!==348||header.getInt16(70,little)!==2||header.getInt16(254,little)===0)throw new Error('This comparison requires uint8 NIfTI-1 with an sform.');
    const slope=header.getFloat32(112,little);
    if(slope!==0&&(slope!==1||header.getFloat32(116,little)!==0))throw new Error('Unexpected intensity scaling.');
    const dims=[0,1,2].map(i=>header.getInt16(42+2*i,little));
    return {dims,affine:Array.from({length:12},(_,i)=>header.getFloat32(280+4*i,little)),data:new Uint8Array(buffer,header.getFloat32(108,little),dims.reduce((a,b)=>a*b,1))};
  };
  const input=await fetchBytes(inputURL),reference=await uint8Nifti(await fetchBytes(referenceURL));
  const worker=new Worker(workerURL,{type:'module'}),started=performance.now();
  let result;
  try {
    result=await new Promise((resolve,reject)=>{
      worker.onerror=e=>reject(new Error(e.message));
      worker.onmessage=({data})=>{
        if(data.type==='progress')onProgress(data.value,data.message);
        if(data.type==='error')reject(new Error(data.message));
        if(data.type==='result')resolve(data.result);
      };
      worker.postMessage({stage:'synthsr',buffer:input,backend,ct:false});
    });
  }finally{worker.terminate();}
  const output=await uint8Nifti(result.buffer);
  if(output.dims.join()!==reference.dims.join())throw new Error('Output dimensions differ.');
  let mismatches=0,maxError=0;
  for(let i=0;i<output.data.length;i++){
    const delta=Math.abs(output.data[i]-reference.data[i]);
    maxError=Math.max(maxError,delta);mismatches+=delta!==0;
  }
  const maxAffineError=Math.max(...output.affine.map((v,i)=>Math.abs(v-reference.affine[i])));
  const report={backend,provenance:result.provenance,workerSeconds:(performance.now()-started)/1000,voxels:output.data.length,mismatches,maxError,maxAffineError};
  report.pass=maxError<=1&&mismatches/output.data.length<.001&&maxAffineError<2e-5&&result.provenance.backend===backend&&result.provenance.flip&&result.provenance.sharpen&&!result.provenance.tiled;
  if(backend==='webgpu')report.pass&&=result.provenance.gpuImplementation==='synthsr-blocked-fp32-v1';
  return report;
}
