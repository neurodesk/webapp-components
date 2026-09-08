#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { synthesize, resolveModel, defaultThreads } from '../src/node.js';
const help=`SynthSR 0.1.0 — native brain image synthesis (Node.js 22+)

Usage:
  synthsr INPUT.nii[.gz] [OUTPUT.nii[.gz]] [options]
  synthsr download-model [--cache-dir DIR]

Options:
  --model FILE       Use the validated local ONNX model (no model download)
  --cache-dir DIR    Shared model cache (default: XDG_CACHE_HOME or ~/.cache)
  --offline          Require a local or cached model; never download
  --threads N        Native CPU threads (default: SLURM_CPUS_PER_TASK, or up to 4)
  --device cpu|cuda  Native execution provider (default: cpu)
  --ct               Input is CT in Hounsfield units
  --no-flip          Disable left–right averaging (default: enabled)
  --no-sharpen       Disable sharpening (default: enabled)
  --tiled            Approximate low-memory mode; changes spatial context
  --force            Replace existing output and JSON sidecar
  --quiet            Suppress progress messages
  --help, -h         Show this help
  --version, -v      Print the package version

Output defaults to INPUT_synthsr.nii.gz (or INPUT_synthsr_tiled.nii.gz).
A JSON sidecar records settings, model checksum, geometry and timings.
CUDA requires the matching ONNX Runtime provider and CUDA/cuDNN libraries;
unavailable CUDA fails explicitly. CPU requires no GPU or browser.
`;
try {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{
    model:{type:'string'},'cache-dir':{type:'string'},threads:{type:'string'},device:{type:'string'},
    offline:{type:'boolean'},ct:{type:'boolean'},'no-flip':{type:'boolean'},'no-sharpen':{type:'boolean'},
    tiled:{type:'boolean'},force:{type:'boolean'},quiet:{type:'boolean'},help:{type:'boolean',short:'h'},version:{type:'boolean',short:'v'},
  }});
  if(values.help){console.log(help);}
  else if(values.version){console.log('0.1.0');}
  else {
    let last='';
    const onProgress=(_,message)=>{if(!values.quiet&&message!==last){console.error(message);last=message;}};
    const modelOptions={modelPath:values.model,cacheDir:values['cache-dir'],offline:values.offline,onProgress};
    if(positionals[0]==='download-model') {
      if(positionals.length!==1)throw new Error('download-model does not accept input/output paths.');
      console.log((await resolveModel(modelOptions)).path);
    } else {
      if(positionals.length<1||positionals.length>2)throw new Error('Provide an input and optional output NIfTI path. Run synthsr --help for usage.');
      const result=await synthesize({input:positionals[0],output:positionals[1],...modelOptions,
        threads:values.threads===undefined?defaultThreads():Number(values.threads),device:values.device||'cpu',
        ct:!!values.ct,tiled:!!values.tiled,flip:!values['no-flip'],sharpen:!values['no-sharpen'],force:!!values.force,onProgress});
      console.log(result.output);
      if(!values.quiet)console.error(`Saved ${result.reportPath} · ${result.provenance.seconds.toFixed(1)} s`);
    }
  }
} catch(error) { console.error(`SynthSR: ${error.message || error}`);process.exitCode=1; }
