import NiiVue, { MULTIPLANAR_TYPE, SLICE_TYPE, SHOW_RENDER } from '@niivue/niivue';
import { mountImagingWorkspace } from '@neurodesk/webapp-components/core/mount-imaging-workspace';
import { NIFTI_EXAMPLES } from '@neurodesk/webapp-components/example-images';
import { filesFromDataTransferItems } from '@neurodesk/webapp-components/file-io';
import { readImageFiles } from '@neurodesk/runtime-support/dcm2niix-client';
import { readVolume } from './volume.js';
import manifest from '../../../models/synthsr.manifest.json';
import './styles.css';

mountImagingWorkspace({controls:'#controls',viewer:'#viewer',status:'#status',title:'SynthSR',subtitle:'Brain image synthesis, in your browser',mark:'S',controlsContract:{about:'#aboutBtn',standalone:'#standaloneBtn'}});
const $ = (id) => document.getElementById(id);
let source, output, provenance, worker, viewer, viewerReady, busy=false, timer, started, exampleAbort;
let importAbort, importedImages = [], loadedExample = '';
const assetBase=import.meta.env.VITE_SYNTHSR_ASSET_BASE || manifest.base_url || `${import.meta.env.BASE_URL}model-assets/`;
const exampleURL=import.meta.env.VITE_SYNTHSR_EXAMPLE_URL || 'https://raw.githubusercontent.com/neurolabusc/py_synthsr/04ab5548f4609c2b44ca51b3f4bc319b585dafa7/FLAIR.nii.gz';
const excludedExamples = new Set(['CT_Abdo', 'CT_Electrodes', 'Iguana', 'spmMotor']);
const examples = [{ id: 'FLAIR', url: exampleURL }, ...NIFTI_EXAMPLES.filter(example => !excludedExamples.has(example.id))];
for (const example of examples) $('exampleSelect').add(new Option(example.id, example.id));
function status(message,error=false){$('statusText').textContent=message;$('statusText').classList.toggle('error',error);}
function setBusy(value){
  busy=value;
  for(const id of ['imageInput','seriesSelect','exampleSelect','modality','backend','mode','flip','sharpen','modelInput']) $(id).disabled=value;
  $('processButton').disabled=value||!source;$('cancelBtn').hidden=!value;
  $('saveBtn').disabled=value||!output;$('reportBtn').disabled=value||!provenance;
  if(!value){clearInterval(timer);worker?.terminate();worker=null;}
}
async function ensureViewer(){
  if(viewerReady) return viewerReady;
  viewerReady=(async()=>{
    viewer=new NiiVue({isDragDropEnabled:false,backgroundColor:[0.04,0.06,0.08,1]});
    await viewer.attachTo('gl1');viewer.multiplanarType=MULTIPLANAR_TYPE.GRID;viewer.sliceType=SLICE_TYPE.MULTIPLANAR;viewer.showRender=SHOW_RENDER.ALWAYS;
    viewer.isLegendVisible=false;
    viewer.createExtensionContext().on('locationChange',(e)=>{$('location').textContent=e.detail.string;});
    return viewer;
  })();
  return viewerReady;
}
async function show(file,isOutput=false){
  $('emptyState').hidden=true;$('inputTab').classList.toggle('active',!isOutput);$('outputTab').classList.toggle('active',isOutput);
  $('resultBadge').hidden=!isOutput;$('imageLabel').textContent=isOutput?'SYNTHETIC T1 · 1 MM':'ORIGINAL IMAGE';
  try{const nv=await ensureViewer();await nv.loadVolumes([{url:file,name:file.name}]);$('viewerError').hidden=true;}
  catch(error){$('viewerError').hidden=false;$('viewerError').textContent=`Visualization unavailable: ${error.message}. Processing and NIfTI download remain available.`;}
}
async function load(file,exampleId=''){
  if(busy||!file)return;
  try{
    if(!/\.nii(\.gz)?$/i.test(file.name))throw new Error('Choose a .nii or .nii.gz image.');
    status('Reading image…');const volume=readVolume(await file.arrayBuffer());
    source=file;output=null;provenance=null;$('outputSection').open=false;
    loadedExample=exampleId;$('exampleSelect').value=exampleId;
    $('modality').value=volume.data.some(value=>value<0)?'ct':'mr';
    $('inputTab').disabled=false;$('outputTab').hidden=true;$('outputTab').disabled=true;$('saveBtn').disabled=true;$('reportBtn').disabled=true;
    $('progress').value=0;$('elapsed').textContent='';$('fileInfo').hidden=false;
    $('fileInfo').textContent=`${file.name} · ${volume.dims.join(' × ')} voxels`;
    $('processButton').disabled=false;
    await show(source);status('Image loaded · ready to synthesize');
    return true;
  }catch(error){status(error.message,true);return false;}
}
async function importImages(filesPromise) {
  if (busy) return;
  const controller = new AbortController();
  importAbort = controller;
  setBusy(true);status('Reading images · converting DICOM if needed…');
  try {
    const files = await filesPromise;
    const images = await readImageFiles(files, { signal: controller.signal });
    controller.signal.throwIfAborted();
    if (!images.length) throw new Error('Choose NIfTI files or a complete DICOM series.');
    setBusy(false);
    if (!await load(images[0])) return;
    importedImages = images;
    $('seriesSelect').replaceChildren(...images.map((file, index) => new Option(file.name, String(index))));
    $('seriesSelect').hidden = images.length < 2;
  } catch (error) {
    if (!controller.signal.aborted) { setBusy(false);status(error.message, true); }
  } finally {
    if (importAbort === controller) importAbort = null;
  }
}
$('imageInput').onchange=()=>{
  const files = Array.from($('imageInput').files);
  $('imageInput').value = '';
  if (files.length) void importImages(Promise.resolve(files));
};
$('seriesSelect').onchange=async()=>{
  if (!await load(importedImages[Number($('seriesSelect').value)])) $('seriesSelect').value = String(importedImages.indexOf(source));
};
$('dropZone').ondragover=(e)=>{e.preventDefault();$('dropZone').classList.add('dragging');};
$('dropZone').ondragleave=()=>$('dropZone').classList.remove('dragging');
$('dropZone').ondrop=(e)=>{e.preventDefault();$('dropZone').classList.remove('dragging');if(!busy)void importImages(e.dataTransfer.items?.length ? filesFromDataTransferItems(e.dataTransfer.items) : Promise.resolve(Array.from(e.dataTransfer.files)));};
$('exampleSelect').onchange=async()=>{
  const example = examples.find(item => item.id === $('exampleSelect').value);
  if(!example || busy)return;
  setBusy(true);status(`Downloading ${example.id}…`);
  const controller=new AbortController();exampleAbort=controller;
  try{const r=await fetch(example.url,{signal:controller.signal});if(!r.ok)throw new Error('Example download failed. You can load a local NIfTI image instead.');const bytes=await r.arrayBuffer();if(controller.signal.aborted)return;setBusy(false);const file = new File([bytes],`${example.id}.nii.gz`);if(await load(file,example.id))$('seriesSelect').hidden=true;}
  catch(e){if(e.name!=='AbortError'){setBusy(false);status(e.message,true);}}
  finally{if(exampleAbort===controller){exampleAbort=null;$('exampleSelect').value=loadedExample;}}
};
$('mode').onchange=()=>{$('modeHelp').textContent=$('mode').value==='tiled'?'Approximate: overlapping 96³ tiles reduce memory. Limited context can change the output and introduce seams.':'Full-volume synthesis can require several GB of memory.';};
$('modelInput').onchange=()=>{$('modelInfo').textContent=$('modelInput').files[0]?.name||'SynthSR v2 · original pretrained weights';};
$('processButton').onclick=()=>{
  if(!source||busy)return;
  output=null;provenance=null;$('outputSection').open=false;$('outputTab').hidden=true;$('outputTab').disabled=true;$('resultBadge').hidden=true;
  show(source);
  const options={ct:$('modality').value==='ct',backend:$('backend').value,tiled:$('mode').value==='tiled',flip:$('flip').checked,sharpen:$('sharpen').checked};
  setBusy(true);$('progress').value=0;started=performance.now();timer=setInterval(()=>{$('elapsed').textContent=`${Math.round((performance.now()-started)/1000)} s`;},1000);
  worker=new Worker(new URL('./inference-worker.js',import.meta.url),{type:'module'});
  worker.onmessage=async({data})=>{
    if(data.type==='progress'){status(data.message);$('progress').value=data.value;}
    if(data.type==='error'){setBusy(false);status(data.message,true);}
    if(data.type==='result'){
      provenance=data.provenance;const stem=source.name.replace(/\.nii(\.gz)?$/i,'');
      output=new File([data.buffer],`${stem}_synthsr${options.tiled?'_tiled':''}.nii`,{type:'application/octet-stream'});
      setBusy(false);$('outputSection').open=true;$('outputTab').hidden=false;$('outputTab').disabled=false;$('progress').value=1;
      await show(output,true);status(`Synthetic T1 ready · ${provenance.outputShape.join(' × ')} · ${Math.round(provenance.seconds)} s${options.tiled?' · approximate tiled mode':''}`);
    }
  };
  worker.onerror=(e)=>{setBusy(false);status(`Processing stopped: ${e.message || 'The inference worker could not run. Reload the app and try again.'}`,true);};
  const asset=manifest.assets.find((a)=>a.filename==='synthsr-v2.onnx');
  worker.postMessage({file:source,options,model:{...asset,url:`${asset.url||`${assetBase}${asset.filename}`}?sha256=${asset.sha256}`,file:$('modelInput').files[0]}});
};
$('cancelBtn').onclick=()=>{exampleAbort?.abort();importAbort?.abort();setBusy(false);$('progress').value=0;status('Processing cancelled. Your original image is unchanged.');};
$('inputTab').onclick=()=>source&&show(source);$('outputTab').onclick=()=>output&&show(output,true);
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('saveBtn').onclick=()=>output&&download(output,output.name);
$('reportBtn').onclick=()=>provenance&&download(new Blob([JSON.stringify(provenance,null,2)],{type:'application/json'}),output.name.replace('.nii','.json'));
$('aboutBtn').onclick=()=>$('aboutDialog').showModal();
$('standaloneBtn').onclick=()=>$('standaloneDialog').showModal();
$('standalonePackage').href=`${import.meta.env.BASE_URL}downloads/neurodesk-synthsr-0.2.20260909.tgz`;
if(!navigator.gpu){$('backend').value='wasm';status('Ready · WebGPU unavailable; CPU processing selected');}
window.addEventListener('pagehide',()=>{exampleAbort?.abort();importAbort?.abort();worker?.terminate();clearInterval(timer);});
