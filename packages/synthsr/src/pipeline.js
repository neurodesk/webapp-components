import { readVolume, prepare, flipInput, finish, writeVolume } from './volume.js';
import { runTiled } from './tiling.js';

// Both runtimes supply only model loading, session creation and the Tensor class.
// Spatial processing, augmentation, inference scaling and serialization are shared.
export async function runSynthsr({ buffer, options = {}, loadModel, createSession, Tensor,
  onProgress = () => {}, runtime = {} }) {
  const settings = { ct: false, tiled: false, flip: true, sharpen: true, ...options };
  const started = performance.now(), timings = {};
  let previous = started, session;
  const mark = (name) => { const now=performance.now();timings[name]=(now-previous)/1000;previous=now; };
  const network = async (input, dims) => {
    const tensor = new Tensor('float32', input, [1,1,...dims]);
    let outputs;
    try {
      outputs = await session.run({ [session.inputNames[0]]: tensor });
      const output = outputs[session.outputNames[0]];
      if (output.dims.join() !== [1,1,...dims].join()) throw new Error('Model output shape does not match the SynthSR contract.');
      const result = Float32Array.from(await output.getData());
      for (let i=0;i<result.length;i++) {
        if (!Number.isFinite(result[i])) throw new Error('Inference produced non-finite output.');
        result[i] = Math.min(128,Math.max(0,255*result[i]));
      }
      return result;
    } finally { tensor.dispose();if(outputs)Object.values(outputs).forEach(t=>t.dispose()); }
  };
  const infer = async (input, dims, stage) => {
    if (!settings.tiled || dims.every(d=>d<=96)) {
      onProgress(stage,'Synthesizing volume… this can take several minutes');
      return network(input,dims);
    }
    return runTiled(input,dims,network,
      (done,total)=>onProgress(stage+0.25*done/total,`Synthesizing tile ${done} of ${total}`));
  };
  try {
    onProgress(.01,'Reading NIfTI…');
    const volume=readVolume(buffer);mark('read');
    onProgress(.03,'Resampling to 1 mm and preparing intensities…');
    const prep=prepare(volume,settings);mark('preprocess');
    onProgress(.12,`Prepared ${prep.paddedDims.join(' × ')} voxels`);
    const model=await loadModel();mark('model');
    onProgress(.26,'Initializing inference…');
    session=await createSession(model.bytes,settings.backend,settings.tiled?prep.paddedDims.map(d=>Math.min(96,d)):prep.paddedDims);
    mark('initialize');
    let result=await infer(prep.input,prep.paddedDims,.32);
    if(settings.flip) {
      onProgress(.6,'Synthesizing flipped image…');
      const flipped=await infer(flipInput(prep.input,prep.paddedDims),prep.paddedDims,.6);
      const slab=prep.paddedDims[1]*prep.paddedDims[2];
      for(let x=0;x<prep.paddedDims[0];x++)for(let i=0;i<slab;i++)result[x*slab+i]=.5*(result[x*slab+i]+flipped[(prep.paddedDims[0]-1-x)*slab+i]);
    }
    mark('inference');
    await session.release();session=null;mark('release');
    onProgress(.92,'Restoring orientation and saving synthetic T1…');
    const output=finish(result,prep,settings), resultBuffer=writeVolume(output);mark('postprocess');
    const provenance={package:'@neurodesk/synthsr',version:'0.2.20260909',model:'synthsr_v20_230130',modelSha256:model.hash,
      ...runtime,...settings,inputShape:volume.dims,outputShape:output.dims,outputAffine:output.affine,
      spacingMm:[1,1,1],seconds:(performance.now()-started)/1000,timings,synthetic:true};
    return {buffer:resultBuffer,provenance};
  } finally { await session?.release(); }
}
