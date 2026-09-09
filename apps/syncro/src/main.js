import NiiVue,{MULTIPLANAR_TYPE,SLICE_TYPE} from '@niivue/niivue';
import {mountImagingWorkspace} from '@neurodesk/webapp-components/core/mount-imaging-workspace';
import {bindSectionDisclosures} from '@neurodesk/webapp-components/ui';
import {readVolume} from '@neurodesk/synthsr';
import {readImageFiles} from '@neurodesk/runtime-support/dcm2niix-client';
import {zipSync} from 'fflate';
import {templateAsset} from '../../../packages/syncro/src/assets.js';
import './styles.css';
mountImagingWorkspace({controls:'#controls',viewer:'#viewer',status:'#status',title:'SYNcro',subtitle:'Normalize brain scans and aligned lesion maps to MNI space',mark:'S',controlsContract:{about:'#aboutBtn',cite:'#citeBtn',privacy:'#privacyBtn'}});
bindSectionDisclosures(document);
const $=id=>document.getElementById(id),base=new URL(import.meta.env.BASE_URL,location.href);
let source,worker,viewer,viewerReady,busy=false,outputs,additional=[],timer,start,exampleAbort,importAbort;
const status=m=>$('statusText').textContent=m;
const log=m=>{$('log').textContent=($('log').textContent+'\n'+m).slice(-18000);};
function setBusy(value){busy=value;for(const id of ['input','example','additional','modality','synthsrBackend','brainExtractor'])$(id).disabled=value;for(const s of $('additionalList').querySelectorAll('select'))s.disabled=value;$('runButton').disabled=value||!source;$('cancel').hidden=!value;$('download').disabled=value||!outputs;$('resultSelect').disabled=value||!source;if(!value){clearInterval(timer);worker?.terminate();worker=null;}}
async function getViewer(){if(!viewerReady)viewerReady=(async()=>{viewer=new NiiVue({isDragDropEnabled:false});await viewer.attachTo('gl1');viewer.multiplanarType=MULTIPLANAR_TYPE.GRID;viewer.sliceType=SLICE_TYPE.MULTIPLANAR;return viewer;})();return viewerReady;}
async function show(file,overlay=false){
 $('empty').hidden=true;$('viewLabel').textContent=overlay?'MNI template + '+file.name:file.name;
 try {const nv=await getViewer();await nv.loadVolumes(overlay?[{url:templateAsset.url,name:'MNI template'},{url:file,name:file.name,opacity:Number($('opacity').value)/100}]:[{url:file,name:file.name}]);$('viewerError').hidden=true;}
 catch(e){$('viewerError').hidden=false;$('viewerError').textContent='Viewer unavailable: '+e.message;}
}
async function load(file){if(busy||!file)return;try{if(!/\.nii(\.gz)?$/i.test(file.name))throw new Error('Choose a NIfTI image (.nii or .nii.gz).');const v=readVolume(await file.arrayBuffer());source=file;outputs=null;$('results').open=false;$('download').disabled=true;$('resultSelect').replaceChildren(new Option('Original acquired image','original'));$('resultSelect').value='original';$('resultSelect').disabled=false;updateOpacityControl('original');$('fileInfo').textContent=file.name+' · '+v.dims.join(' × ');$('runButton').disabled=true;$('progress').value=0;await show(file);$('runButton').disabled=false;status('Ready to normalize · '+file.name);}catch(e){source=null;$('runButton').disabled=true;$('resultSelect').disabled=true;status(e.message);}}
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
 if(!source||busy)return;outputs=null;$('resultSelect').replaceChildren(new Option('Original acquired image','original'));updateOpacityControl('original');setBusy(true);status('Preparing normalization…');$('progress').value=0;$('results').open=false;$('log').textContent='';start=performance.now();timer=setInterval(()=>$('elapsed').textContent=Math.round((performance.now()-start)/1000)+' s',1000);
 worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
 worker.onerror=e=>{status(e.message?'Processing failed: '+e.message:'Could not load the processing worker. Reload the page and try again.');setBusy(false);};
 worker.onmessage=({data})=>{
  if(data.type==='log'){log(data.message);return;}
  if(data.type==='error'){if(/Accompanying|Binary lesion|Label images/.test(data.message))$('additionalSection').open=true;status(data.message);log(data.message);setBusy(false);return;}
  if(data.type==='progress'){const ranges={synthsr:[0,.45],mindgrab:[.45,.25],synthstrip:[.45,.25],registration:[.7,.25],resampling:[.95,.05],complete:[1,0]},r=ranges[data.stage]||[0,0];if(data.value!==null)$('progress').value=r[0]+r[1]*data.value;status(data.message||({synthsr:'Synthesizing T1…',mindgrab:'Extracting brain with MindGrab…',synthstrip:'Extracting brain with SynthStrip…',registration:'Registering to MNI…',resampling:'Warping original images…'}[data.stage]||data.stage));return;}
  if(data.type==='result'){outputs=data.outputs;setBusy(false);$('progress').value=1;status('Normalization complete · review the MNI alignment');$('results').open=true;populateViews();$('resultSelect').value='warped-original.nii.gz';$('resultSelect').disabled=false;$('resultSelect').dispatchEvent(new Event('change'));}
 };
 worker.postMessage({input:source,additional,ct:$('modality').value==='ct',synthsrBackend:$('synthsrBackend').value,brainExtractor:$('brainExtractor').value,modelBase:import.meta.env.VITE_SYNCRO_MODEL_BASE,mindgrabAssetPath:new URL('mindgrab/',base).href,templateURL:templateAsset.url,registrationURL:new URL('registration/syncro-registration.mjs',base).href});
};
$('cancel').onclick=()=>{importAbort?.abort();importAbort=null;exampleAbort?.abort();setBusy(false);status('Processing cancelled');$('progress').value=0;};
const viewLabels={'synthetic-t1.nii':'Synthetic T1','synthetic-brain.nii':'Synthetic brain','brain-mask.nii':'Brain mask','warped-synthetic-brain.nii.gz':'Warped synthetic brain','warped-original.nii.gz':'Warped acquired image'};
function populateViews(){$('resultSelect').replaceChildren(new Option('Original acquired image','original'));for(const name of Object.keys(outputs))if(/\.nii(\.gz)?$/.test(name)&&!name.includes('Warp'))$('resultSelect').add(new Option(viewLabels[name]||name,name));}
function updateOpacityControl(name){const overlay=name.startsWith('warped-');$('opacityControl').hidden=!overlay;$('opacity').disabled=!overlay;}
$('resultSelect').onchange=()=>{const name=$('resultSelect').value;updateOpacityControl(name);if(name==='original')show(source);else if(outputs?.[name])show(new File([outputs[name]],name),name.startsWith('warped-'));};
$('opacity').oninput=()=>{$('opacityValue').textContent=$('opacity').value+'%';if(viewer?.volumes.length>1){viewer.volumes[1].opacity=Number($('opacity').value)/100;viewer.updateGLVolume();}};
$('download').onclick=()=>{if(!outputs)return;const bytes=zipSync(outputs,{level:1});const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download='syncro-results.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function copyText(button,value){try{await navigator.clipboard.writeText(value);const original=button.textContent;button.textContent='Copied';if($('copyStatus'))$('copyStatus').textContent='Copied to clipboard';setTimeout(()=>button.textContent=original,1200);}catch{status('Could not copy automatically. Select the text and copy it manually.');}}
document.addEventListener('click',event=>{const button=event.target.closest('.copy-command');if(button)copyText(button,$(button.dataset.copyTarget).textContent);});
$('copyLog').onclick=()=>copyText($('copyLog'),$('log').textContent);$('clearLog').onclick=()=>{$('log').textContent='';};
for(const icon of document.querySelectorAll('.info-icon')){
 const tooltip=icon.querySelector('.info-tooltip');
 const place=()=>{tooltip.hidden=false;const iconRect=icon.getBoundingClientRect(),tipRect=tooltip.getBoundingClientRect();let top=iconRect.top-tipRect.height-6;if(top<4)top=iconRect.bottom+6;const left=Math.max(4,Math.min(iconRect.left+iconRect.width/2-tipRect.width/2,innerWidth-tipRect.width-4));Object.assign(tooltip.style,{top:top+'px',left:left+'px'});};
 const hide=()=>tooltip.hidden=true;tooltip.hidden=true;icon.addEventListener('mouseenter',place);icon.addEventListener('mouseleave',hide);icon.addEventListener('focus',place);icon.addEventListener('blur',hide);
}
function info(title,html,citations=false){$('infoTitle').textContent=title;$('infoBody').innerHTML=html;$('info').classList.toggle('citations-dialog',citations);$('info').showModal();}
$('aboutBtn').onclick=()=>info('About SYNcro','<p>SynthSR → brain extraction (MindGrab by default, or SynthStrip) → ANTs SyN normalization to the MNI152 1 mm brain template. The transformation is applied to the original acquired image.</p><p>Synthetic contrast may alter lesions. Review the original image, brain mask and alignment before using results. This experimental implementation is for research.</p><p>Code: Apache-2.0 with upstream attribution. MindGrab is MIT licensed. The MNI template has separate <a href="data/FSL-LICENSE.txt">FSL terms for non-commercial use</a>.</p>');
$('standaloneBtn').onclick=()=>info('Standalone',$('standaloneContent').innerHTML);
$('citeBtn').onclick=()=>info('Citations',`
 <div class="citation-section citation-primary"><div class="citation-item"><strong>SYNcro</strong><span class="citation-ref">Code: <a href="https://github.com/neurodesk/webapps/tree/main/apps/syncro" target="_blank" rel="noopener">web application</a> · <a href="https://github.com/neurodesk/neurocontainers/tree/main/recipes/syncro" target="_blank" rel="noopener">container recipe</a></span><p>Neurodesk (2026). <em>SYNcro</em> (version 0.1.4) [Computer software].</p><a href="https://webapps.neurodesk.org/syncro/" target="_blank" rel="noopener">webapps.neurodesk.org/syncro</a></div></div>
 <p class="citations-intro">SYNcro combines the methods below. Please cite each paper when using results from this workflow.</p>
 <div class="citation-section"><h3>Image synthesis</h3><div class="citation-item"><strong>SynthSR</strong><span class="citation-ref">Code: <a href="https://github.com/BBillot/SynthSR" target="_blank" rel="noopener">SynthSR</a></span><p>Iglesias, J. E., Billot, B., Balbastre, Y., Tabari, A., Conklin, J., González, R. G., Alexander, D. C., Golland, P., Edlow, B. L., Fischl, B., &amp; Alzheimer’s Disease Neuroimaging Initiative (2021). “Joint super-resolution and synthesis of 1 mm isotropic MP-RAGE volumes from clinical MRI exams with scans of different orientation, resolution and contrast.” <em>NeuroImage</em>, 237, 118206.</p><a href="https://doi.org/10.1016/j.neuroimage.2021.118206" target="_blank" rel="noopener">DOI: 10.1016/j.neuroimage.2021.118206</a></div></div>
 <div class="citation-section"><h3>Brain extraction</h3><div class="citation-item"><strong>Brainchop / MindGrab</strong><span class="citation-ref">Code: <a href="https://github.com/neuroneural/brainchop" target="_blank" rel="noopener">Brainchop</a></span><p>Masoud, M., et al. (2023). “Brainchop: In-browser MRI volumetric segmentation and rendering.” <em>Journal of Open Source Software</em>, 8(83), 5098.</p><a href="https://doi.org/10.21105/joss.05098" target="_blank" rel="noopener">DOI: 10.21105/joss.05098</a></div><div class="citation-item"><strong>SynthStrip</strong><span class="citation-ref">Code: <a href="https://surfer.nmr.mgh.harvard.edu/docs/synthstrip/" target="_blank" rel="noopener">SynthStrip</a></span><p>Hoopes, A., Mora, J. S., Dalca, A. V., Fischl, B., &amp; Hoffmann, M. (2022). “SynthStrip: Skull-stripping for any brain image.” <em>NeuroImage</em>, 260, 119474.</p><a href="https://doi.org/10.1016/j.neuroimage.2022.119474" target="_blank" rel="noopener">DOI: 10.1016/j.neuroimage.2022.119474</a></div></div>
 <div class="citation-section"><h3>Image registration</h3><div class="citation-item"><strong>Advanced Normalization Tools (ANTs)</strong><span class="citation-ref">Code: <a href="https://github.com/ANTsX/ANTs" target="_blank" rel="noopener">ANTs</a></span><p>Avants, B. B., Tustison, N. J., Song, G., Cook, P. A., Klein, A., &amp; Gee, J. C. (2011). “A reproducible evaluation of ANTs similarity metric performance in brain image registration.” <em>NeuroImage</em>, 54(3), 2033–2044.</p><a href="https://doi.org/10.1016/j.neuroimage.2010.09.025" target="_blank" rel="noopener">DOI: 10.1016/j.neuroimage.2010.09.025</a></div></div>
 <div class="citation-section"><h3>Visualization</h3><div class="citation-item"><strong>NiiVue</strong><span class="citation-ref">Code: <a href="https://github.com/niivue/niivue" target="_blank" rel="noopener">NiiVue</a></span><p>NiiVue authors (2026). <em>NiiVue</em> (version 1.0.0-rc.11) [Computer software].</p><a href="https://niivue.com" target="_blank" rel="noopener">niivue.com</a></div></div>`,true);
$('privacyBtn').onclick=()=>info('Privacy','<p>Your images are processed locally in this browser. SynthSR, optional SynthStrip and the MNI template are downloaded from Hugging Face; MindGrab ships with the app. The optional example is downloaded from OpenNeuro. Model bytes may be cached on this device. Images are not uploaded to a processing service.</p>');
window.addEventListener('pagehide',()=>{importAbort?.abort();worker?.terminate();exampleAbort?.abort();clearInterval(timer);});
