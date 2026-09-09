import {build} from 'esbuild';
import {cp,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(root+'dist',{recursive:true});
for(const name of ['index','node'])await build({entryPoints:[root+`src/${name}.js`],outfile:root+`dist/${name}.js`,bundle:true,format:'esm',platform:name==='node'?'node':'browser',target:'es2022',external:['onnxruntime-node','nifti-reader-js']});
await cp(new URL('../../registration/wasm',import.meta.url),root+'dist/registration',{recursive:true});
