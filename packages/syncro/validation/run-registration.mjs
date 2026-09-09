import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRegistration} from '../../registration/src/index.js';
import {readVolume,writeVolume} from '../../synthsr/src/index.js';
const [modulePath,fixed,moving,original,out]=process.argv.slice(2);
if(!out)throw new Error('Usage: run-registration.mjs module.mjs fixed.nii.gz brain.nii.gz original.nii.gz output');
await mkdir(out,{recursive:true});
const {default:createModule}=await import(pathToFileURL(modulePath));
const runtime=await createRegistration({createModule,wasmBinary:await readFile(modulePath.replace(/\.mjs$/,'.wasm')),onLog:console.log});
async function load(path){const b=await readFile(path);return writeVolume(readVolume(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),'registration input');}
const start=performance.now();
const reg=runtime.register({fixed:await load(fixed),moving:await load(moving)});
const registrationSeconds=(performance.now()-start)/1000;
await writeFile(out+'/warped-brain.nii.gz',reg.warped);
for(const [name,bytes]of Object.entries(reg.transforms))await writeFile(out+'/'+name,bytes);
const applied=runtime.apply({registration:reg,moving:await load(original)});
await writeFile(out+'/warped-original.nii.gz',applied);
await writeFile(out+'/report.json',JSON.stringify({registrationSeconds,totalSeconds:(performance.now()-start)/1000,memoryBytes:runtime.memoryBytes()},null,2));
runtime.release(reg);console.log('Finished',out);
