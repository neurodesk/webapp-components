import NiiVue, { MULTIPLANAR_TYPE, SLICE_TYPE, SHOW_RENDER } from '@niivue/niivue';
import { mountImagingWorkspace } from '@neurodesk/webapp-components/core/mount-imaging-workspace';
import { NIFTI_EXAMPLES } from '@neurodesk/webapp-components/example-images';
import { readVolume } from './volume.js';
import manifest from '../../../models/synthsr.manifest.json';
import './styles.css';

mountImagingWorkspace({controls:'#controls',viewer:'#viewer',status:'#status',title:'SynthSR',subtitle:'Brain image synthesis, in your browser',mark:'S',controlsContract:{about:'#aboutBtn'}});
const $ = (id) => document.getElementById(id);
let source, output, provenance, worker, viewer, viewerReady, busy=false, timer, started, exampleAbort;
const assetBase=import.meta.env.VITE_SYNTHSR_ASSET_BASE || manifest.base_url || `${import.meta.env.BASE_URL}model-assets/`;
const exampleURL=import.meta.env.VITE_SYNTHSR_EXAMPLE_URL || 'https://raw.githubusercontent.com/neurolabusc/py_synthsr/04ab5548f4609c2b44ca51b3f4bc319b585dafa7/FLAIR.nii.gz';
const examples = [{ id: 'FLAIR', url: exampleURL, modality: 'mr' }, ...NIFTI_EXAMPLES];
for (const example of examples) $('exampleSelect').add(new Option(example.id, example.id));
function status(message,error=false){$('statusText').textContent=message;$('statusText').classList.toggle('error',error);}
function setBusy(value){
  busy=value;
  for(const id of ['imageInput','exampleBtn','exampleSelect','modality','backend','mode','flip','sharpen','modelInput']) $(id).disabled=value;
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
async function load(file, modality){
  if(busy||!file)return;
  try{
    if(!/\.nii(\.gz)?$/i.test(file.name))throw new Error('Choose a .nii or .nii.gz image.');
    status('Reading image…');const volume=readVolume(await file.arrayBuffer());
    source=file;output=null;provenance=null;$('outputSection').open=false;
    if(modality)$('modality').value=modality;
    $('inputTab').disabled=false;$('outputTab').disabled=true;$('saveBtn').disabled=true;$('reportBtn').disabled=true;
    $('progress').value=0;$('elapsed').textContent='';$('fileInfo').hidden=false;
    $('fileInfo').textContent=`${file.name} · ${volume.dims.join(' × ')} voxels`;
    $('processButton').disabled=false;
    await show(source);status('Image loaded · ready to synthesize');
  }catch(error){status(error.message,true);}
}
$('imageInput').onchange=()=>load($('imageInput').files[0]);
$('dropZone').ondragover=(e)=>{e.preventDefault();$('dropZone').classList.add('dragging');};
$('dropZone').ondragleave=()=>$('dropZone').classList.remove('dragging');
$('dropZone').ondrop=(e)=>{e.preventDefault();$('dropZone').classList.remove('dragging');if(e.dataTransfer.files.length!==1){status('Choose one input image at a time.',true);return;}load(e.dataTransfer.files[0]);};
$('exampleBtn').onclick=async()=>{
  const example = examples.find(item => item.id === $('exampleSelect').value);
  setBusy(true);status(`Downloading ${example.id}…`);
  const controller=new AbortController();exampleAbort=controller;
  try{const r=await fetch(example.url,{signal:controller.signal});if(!r.ok)throw new Error('Example download failed. You can load a local NIfTI image instead.');const bytes=await r.arrayBuffer();if(controller.signal.aborted)return;setBusy(false);const file = new File([bytes],`${example.id}.nii.gz`);await load(file,example.modality);}
  catch(e){if(e.name!=='AbortError'){setBusy(false);status(e.message,true);}}
  finally{if(exampleAbort===controller)exampleAbort=null;}
};
$('mode').onchange=()=>{$('modeHelp').textContent=$('mode').value==='tiled'?'Approximate: overlapping 96³ tiles reduce memory. Limited context can change the output and introduce seams.':'Full-volume synthesis can require several GB of memory.';};
$('modelInput').onchange=()=>{$('modelInfo').textContent=$('modelInput').files[0]?.name||'SynthSR v2 · original pretrained weights';};
$('processButton').onclick=()=>{
  if(!source||busy)return;
  output=null;provenance=null;$('outputSection').open=false;$('outputTab').disabled=true;$('resultBadge').hidden=true;
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
      setBusy(false);$('outputSection').open=true;$('outputTab').disabled=false;$('progress').value=1;
      await show(output,true);status(`Synthetic T1 ready · ${provenance.outputShape.join(' × ')} · ${Math.round(provenance.seconds)} s${options.tiled?' · approximate tiled mode':''}`);
    }
  };
  worker.onerror=(e)=>{setBusy(false);status(`Processing stopped: ${e.message || 'The inference worker could not run. Reload the app and try again.'}`,true);};
  const asset=manifest.assets.find((a)=>a.filename==='synthsr-v2.onnx');
  worker.postMessage({file:source,options,model:{...asset,url:`${asset.url||`${assetBase}${asset.filename}`}?sha256=${asset.sha256}`,file:$('modelInput').files[0]}});
};
$('cancelBtn').onclick=()=>{exampleAbort?.abort();setBusy(false);$('progress').value=0;status('Processing cancelled. Your original image is unchanged.');};
$('inputTab').onclick=()=>source&&show(source);$('outputTab').onclick=()=>output&&show(output,true);
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('saveBtn').onclick=()=>output&&download(output,output.name);
$('reportBtn').onclick=()=>provenance&&download(new Blob([JSON.stringify(provenance,null,2)],{type:'application/json'}),output.name.replace('.nii','.json'));
$('aboutBtn').onclick=()=>$('aboutDialog').showModal();
$('standaloneBtn').onclick=()=>$('standaloneDialog').showModal();
$('standalonePackage').href=`${import.meta.env.BASE_URL}downloads/neurodesk-synthsr-0.1.0.tgz`;
if(!navigator.gpu){$('backend').value='wasm';status('Ready · WebGPU unavailable; CPU processing selected');}
window.addEventListener('pagehide',()=>{exampleAbort?.abort();worker?.terminate();clearInterval(timer);});
