import NiiVue,{MULTIPLANAR_TYPE,SLICE_TYPE} from '@niivue/niivue';
import {mountImagingWorkspace} from '@neurodesk/webapp-components/core/mount-imaging-workspace';
import {readVolume} from '@neurodesk/synthsr';
import {readImageFiles} from '@neurodesk/runtime-support/dcm2niix-client';
import {zipSync} from 'fflate';
import {templateAsset} from '../../../packages/syncro/src/assets.js';
import './styles.css';
mountImagingWorkspace({controls:'#controls',viewer:'#viewer',status:'#status',title:'SYNcro',subtitle:'Normalize brain scans and aligned lesion maps to MNI space',mark:'S',controlsContract:{about:'#aboutBtn',cite:'#citeBtn',privacy:'#privacyBtn'}});
const $=id=>document.getElementById(id),base=new URL(import.meta.env.BASE_URL,location.href);
let source,worker,viewer,viewerReady,busy=false,outputs,additional=[],timer,start,exampleAbort,importAbort;
const status=m=>$('statusText').textContent=m;
const log=m=>{$('log').textContent=($('log').textContent+'\n'+m).slice(-18000);};
function setBusy(value){busy=value;for(const id of ['input','example','additional','modality','synthsrBackend'])$(id).disabled=value;for(const s of $('additionalList').querySelectorAll('select'))s.disabled=value;$('runButton').disabled=value||!source;$('cancel').hidden=!value;$('download').disabled=value||!outputs;$('resultSelect').disabled=value||!source;if(!value){clearInterval(timer);worker?.terminate();worker=null;}}
async function getViewer(){if(!viewerReady)viewerReady=(async()=>{viewer=new NiiVue({isDragDropEnabled:false});await viewer.attachTo('gl1');viewer.multiplanarType=MULTIPLANAR_TYPE.GRID;viewer.sliceType=SLICE_TYPE.MULTIPLANAR;return viewer;})();return viewerReady;}
async function show(file,overlay=false){
 $('empty').hidden=true;$('viewLabel').textContent=overlay?'MNI template + '+file.name:file.name;
 try {const nv=await getViewer();await nv.loadVolumes(overlay?[{url:templateAsset.url,name:'MNI template'},{url:file,name:file.name,opacity:Number($('opacity').value)}]:[{url:file,name:file.name}]);$('viewerError').hidden=true;}
 catch(e){$('viewerError').hidden=false;$('viewerError').textContent='Viewer unavailable: '+e.message;}
}
async function load(file){if(busy||!file)return;try{if(!/\.nii(\.gz)?$/i.test(file.name))throw new Error('Choose a NIfTI image (.nii or .nii.gz).');const v=readVolume(await file.arrayBuffer());source=file;outputs=null;$('results').open=false;$('download').disabled=true;$('resultSelect').replaceChildren(new Option('Original acquired image','original'));$('resultSelect').value='original';$('resultSelect').disabled=false;$('fileInfo').textContent=file.name+' · '+v.dims.join(' × ');$('runButton').disabled=true;$('progress').value=0;await show(file);$('runButton').disabled=false;status('Ready to normalize · '+file.name);}catch(e){source=null;$('runButton').disabled=true;$('resultSelect').disabled=true;status(e.message);}}
$('input').onchange=()=>importScans($('input'),true);
function setAdditional(files){additional=files.map(file=>({file,type:'image'}));$('additionalList').replaceChildren();additional.forEach((item,i)=>{const label=document.createElement('label');label.htmlFor='type-'+i;label.textContent=item.file.name;const select=document.createElement('select');select.id='type-'+i;for(const [value,text]of [['image','Continuous image'],['binary','Binary lesion (0/1)'],['labels','Categorical labels']])select.add(new Option(text,value));select.onchange=()=>item.type=select.value;$('additionalList').append(label,select);});};
$('additional').onchange=()=>importScans($('additional'),false);
async function importScans(input,primary){
 if(busy||!input.files.length)return;
 const files=Array.from(input.files),controller=new AbortController();importAbort=controller;
 if(primary){source=null;outputs=null;$('resultSelect').disabled=true;}
 setBusy(true);status('Reading images · converting DICOM if needed…');
 try{
  const images=await readImageFiles(files,{signal:controller.signal});controller.signal.throwIfAborted();
  if(!images.length)throw new Error('Choose NIfTI files or a complete DICOM series.');
  if(primary&&images.length!==1)throw new Error('Choose one anatomical image or one DICOM series at a time.');
  if(primary){setBusy(false);await load(images[0]);}
  else{for(const file of images)readVolume(await file.arrayBuffer());controller.signal.throwIfAborted();setAdditional(images);status('Accompanying images loaded · choose their image types');}
 }catch(e){if(!controller.signal.aborted)status(e.message);}
 finally{if(importAbort===controller){importAbort=null;setBusy(false);}}
}
$('example').onclick=async()=>{setBusy(true);status('Downloading OpenNeuro ds000001/sub-01…');exampleAbort=new AbortController();try{const r=await fetch(import.meta.env.VITE_SYNCRO_EXAMPLE_URL||'https://s3.amazonaws.com/openneuro.org/ds000001/sub-01/anat/sub-01_T1w.nii.gz',{signal:exampleAbort.signal});if(!r.ok)throw new Error('Example download failed.');const b=await r.arrayBuffer();setBusy(false);await load(new File([b],'sub-01_T1w.nii.gz'));}catch(e){setBusy(false);if(e.name!=='AbortError')status(e.message);}finally{exampleAbort=null;}};
$('runButton').onclick=()=>{
 if(!source||busy)return;outputs=null;$('resultSelect').replaceChildren(new Option('Original acquired image','original'));$('opacity').disabled=true;setBusy(true);status('Preparing normalization…');$('progress').value=0;$('results').open=false;$('log').textContent='';start=performance.now();timer=setInterval(()=>$('elapsed').textContent=Math.round((performance.now()-start)/1000)+' s',1000);
 worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
 worker.onerror=e=>{status(e.message?'Processing failed: '+e.message:'Could not load the processing worker. Reload the page and try again.');setBusy(false);};
 worker.onmessage=({data})=>{
  if(data.type==='log'){log(data.message);return;}
  if(data.type==='error'){if(/Accompanying|Binary lesion|Label images/.test(data.message))$('additionalSection').open=true;status(data.message);log(data.message);setBusy(false);return;}
  if(data.type==='progress'){const ranges={synthsr:[0,.45],synthstrip:[.45,.25],registration:[.7,.25],resampling:[.95,.05],complete:[1,0]},r=ranges[data.stage]||[0,0];if(data.value!==null)$('progress').value=r[0]+r[1]*data.value;status(data.message||({synthsr:'Synthesizing T1…',synthstrip:'Extracting brain…',registration:'Registering to MNI…',resampling:'Warping original images…'}[data.stage]||data.stage));return;}
  if(data.type==='result'){outputs=data.outputs;setBusy(false);$('progress').value=1;status('Normalization complete · review the MNI alignment');$('results').open=true;populateViews();$('resultSelect').value='warped-original.nii.gz';$('resultSelect').disabled=false;$('opacity').disabled=false;$('resultSelect').dispatchEvent(new Event('change'));}
 };
 worker.postMessage({input:source,additional,ct:$('modality').value==='ct',synthsrBackend:$('synthsrBackend').value,modelBase:import.meta.env.VITE_SYNCRO_MODEL_BASE,templateURL:templateAsset.url,registrationURL:new URL('registration/syncro-registration.mjs',base).href});
};
$('cancel').onclick=()=>{importAbort?.abort();importAbort=null;exampleAbort?.abort();setBusy(false);status('Processing cancelled');$('progress').value=0;};
const viewLabels={'synthetic-t1.nii':'Synthetic T1','synthetic-brain.nii':'Synthetic brain','brain-mask.nii':'Brain mask','warped-synthetic-brain.nii.gz':'Warped synthetic brain','warped-original.nii.gz':'Warped acquired image'};
function populateViews(){$('resultSelect').replaceChildren(new Option('Original acquired image','original'));for(const name of Object.keys(outputs))if(/\.nii(\.gz)?$/.test(name)&&!name.includes('Warp'))$('resultSelect').add(new Option(viewLabels[name]||name,name));}
$('resultSelect').onchange=()=>{const name=$('resultSelect').value;if(name==='original')show(source);else if(outputs?.[name])show(new File([outputs[name]],name),name.startsWith('warped-'));};
$('opacity').oninput=()=>{if(viewer?.volumes.length>1){viewer.volumes[1].opacity=Number($('opacity').value);viewer.updateGLVolume();}};
$('download').onclick=()=>{if(!outputs)return;const bytes=zipSync(outputs,{level:1});const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download='syncro-results.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('packageLink').href=new URL('downloads/neurodesk-syncro-0.1.1.tgz',base).href;
async function copyText(button,value){try{await navigator.clipboard.writeText(value);const original=button.textContent;button.textContent='Copied';$('copyStatus').textContent='Copied to clipboard';setTimeout(()=>button.textContent=original,1200);}catch{status('Could not copy automatically. Select the text and copy it manually.');}}
for(const button of document.querySelectorAll('.copy-command'))button.onclick=()=>copyText(button,$(button.dataset.copyTarget).textContent);
$('copyLog').onclick=()=>copyText($('copyLog'),$('log').textContent);$('clearLog').onclick=()=>{$('log').textContent='';};
for(const icon of document.querySelectorAll('.info-icon')){
 const tooltip=icon.querySelector('.info-tooltip');
 const place=()=>{tooltip.hidden=false;const iconRect=icon.getBoundingClientRect(),tipRect=tooltip.getBoundingClientRect();let top=iconRect.top-tipRect.height-6;if(top<4)top=iconRect.bottom+6;const left=Math.max(4,Math.min(iconRect.left+iconRect.width/2-tipRect.width/2,innerWidth-tipRect.width-4));Object.assign(tooltip.style,{top:top+'px',left:left+'px'});};
 const hide=()=>tooltip.hidden=true;tooltip.hidden=true;icon.addEventListener('mouseenter',place);icon.addEventListener('mouseleave',hide);icon.addEventListener('focus',place);icon.addEventListener('blur',hide);
}
function info(title,html){$('infoTitle').textContent=title;$('infoBody').innerHTML=html;$('info').showModal();}
$('aboutBtn').onclick=()=>info('About SYNcro','<p>SynthSR → SynthStrip → ANTs SyN normalization to the MNI152 1 mm brain template. The transformation is applied to the original acquired image.</p><p>Synthetic contrast may alter lesions. Review the original image, brain mask and alignment before using results. This experimental implementation is for research.</p><p>Code: Apache-2.0 with upstream attribution. The MNI template has separate <a href="data/FSL-LICENSE.txt">FSL terms for non-commercial use</a>.</p>');
$('citeBtn').onclick=()=>info('Cite SYNcro','<p><a href="https://github.com/neurodesk/neurocontainers/tree/main/recipes/syncro">Neurodesk SYNcro</a></p><p><a href="https://doi.org/10.1016/j.neuroimage.2021.118206">SynthSR · Iglesias et al. (2021)</a></p><p><a href="https://doi.org/10.1016/j.neuroimage.2022.119474">SynthStrip · Hoopes et al. (2022)</a></p><p><a href="https://github.com/ANTsX/ANTs">Advanced Normalization Tools</a> · <a href="https://niivue.com">NiiVue</a></p>');
$('privacyBtn').onclick=()=>info('Privacy','<p>Your images are processed locally in this browser. Models and the MNI template are downloaded from Hugging Face; the optional example is downloaded from OpenNeuro. Model bytes may be cached on this device. Images are not uploaded to a processing service.</p>');
window.addEventListener('pagehide',()=>{importAbort?.abort();worker?.terminate();exampleAbort?.abort();clearInterval(timer);});
