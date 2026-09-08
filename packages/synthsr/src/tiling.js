export async function runTiled(input, dims, runPatch, onProgress = () => {}) {
  // Approximate mode: 96³ patches, 32-voxel context on internal boundaries.
  // Grid-aligned origins preserve pooling alignment; global intensity normalization
  // happens before patch extraction. Explicitly opt-in: not full-volume parity.
  const size=96, core=32, halo=32, out=new Float32Array(input.length);
  const counts=dims.map((d)=>Math.ceil(d/core)), total=counts.reduce((a,b)=>a*b,1);
  let done=0;
  for(let x=0;x<dims[0];x+=core) for(let y=0;y<dims[1];y+=core) for(let z=0;z<dims[2];z+=core) {
    const start=[x,y,z].map((v,a)=>Math.max(0,Math.min(v-halo,dims[a]-size)));
    const patchDims=dims.map((d)=>Math.min(size,d)), patch=new Float32Array(patchDims.reduce((a,b)=>a*b,1));
    for(let i=0;i<patchDims[0];i++) for(let j=0;j<patchDims[1];j++) {
      const src=((start[0]+i)*dims[1]+start[1]+j)*dims[2]+start[2];
      patch.set(input.subarray(src,src+patchDims[2]),(i*patchDims[1]+j)*patchDims[2]);
    }
    const result=await runPatch(patch,patchDims);
    for(let i=x;i<Math.min(x+core,dims[0]);i++) for(let j=y;j<Math.min(y+core,dims[1]);j++) for(let k=z;k<Math.min(z+core,dims[2]);k++) {
      out[(i*dims[1]+j)*dims[2]+k]=result[((i-start[0])*patchDims[1]+j-start[1])*patchDims[2]+k-start[2]];
    }
    onProgress(++done,total);
  }
  return out;
}
