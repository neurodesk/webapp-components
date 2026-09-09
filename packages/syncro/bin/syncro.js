#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {normalize,downloadModels} from '../dist/node.js';
try {
 const {values,positionals}=parseArgs({allowPositionals:true,options:{help:{type:'boolean',short:'h'},'cache-dir':{type:'string'},offline:{type:'boolean'},ct:{type:'boolean'},threads:{type:'string'},resume:{type:'boolean'},image:{type:'string',multiple:true},lesion:{type:'string',multiple:true},labels:{type:'string',multiple:true}}});
 if(values.help){console.log('Usage: syncro input.nii.gz output-directory [--ct] [--threads N] [--cache-dir PATH] [--offline] [--resume]\n       syncro download-models [--cache-dir PATH]\nAccompanying aligned images: --image FILE, --lesion FILE (0/1 binary), --labels FILE\nCPU synthesis and extraction; ANTs SyN runs in WebAssembly. Node.js 22+.\n--resume verifies and reuses synthesis/extraction checkpoints, then reruns registration.');}
 else {
  const common={cacheDir:values['cache-dir'],offline:values.offline,onProgress:(stage,value,message)=>{if(message)process.stderr.write(`[${stage}] ${message}\n`);}};
  if(positionals[0]==='download-models'){await downloadModels(common);console.log('Models downloaded and verified.');}
  else {if(positionals.length!==2)throw new Error('Provide an input image and a new output directory. Use --help for options.');
   const additional=['image','lesion','labels'].flatMap(type=>(values[type]||[]).map(path=>({path,type:type==='lesion'?'binary':type})));
   const result=await normalize({...common,input:positionals[0],output:positionals[1],ct:values.ct,resume:values.resume,additional,...(values.threads?{threads:Number(values.threads)}:{})});console.log(result.output);
  }
 }
}catch(e){console.error(e.message);process.exitCode=1;}
