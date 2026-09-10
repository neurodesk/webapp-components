import NiiVue, { MULTIPLANAR_TYPE, SLICE_TYPE, SHOW_RENDER } from '@niivue/niivue';
import { mountImagingWorkspace } from '@neurodesk/webapp-components/core/mount-imaging-workspace';
import { ConsoleOutput } from '@neurodesk/webapp-components/ui';
import { downloadBlob, downloadFile, filesFromDataTransferItems, readNifti } from '@neurodesk/webapp-components/file-io';
import { readImageFiles } from '@neurodesk/runtime-support/dcm2niix-client';
import manifest from '@neurodesk/synthseg/manifest';
import { looksLikeCt, outputStem } from './logic.js';
import './styles.css';

mountImagingWorkspace({controls:'#controls',viewer:'#viewer',status:'#status',title:'SynthSeg',subtitle:'FreeSurfer brain labels, in your browser',mark:'S',controlsContract:{about:'#aboutBtn',cite:'#citeBtn',privacy:'#privacyBtn',standalone:'#standaloneBtn'}});
const $ = (id) => document.getElementById(id);
const technicalLog = new ConsoleOutput({ element: 'consoleOutput', mirrorToConsole: false });
const assetBase = import.meta.env.VITE_SYNTHSEG_ASSET_BASE || manifest.base_url;
const exampleURL = import.meta.env.VITE_SYNTHSEG_EXAMPLE_URL || `${manifest.validation.base_url}T1_head.nii.gz`;
const webgpu = Boolean(navigator.gpu);
let source, output, provenance, worker, viewer, viewerReady, busy = false, timer, started;
let exampleAbort, importAbort, importedImages = [], loadedExample = '';

function status(message, error = false) {
  $('statusText').textContent = message;
  $('statusText').classList.toggle('error', error);
  technicalLog.log(message, error ? 'error' : 'info');
}
function setBusy(value) {
  busy = value;
  for (const id of ['imageInput', 'seriesSelect', 'exampleSelect', 'mode', 'ct']) $(id).disabled = value;
  $('processButton').disabled = value || !source || !webgpu;
  $('cancelBtn').hidden = !value;
  $('opacity').disabled = value || !output;
  $('saveBtn').disabled = value || !output;
  $('reportBtn').disabled = value || !provenance;
  if (!value) { clearInterval(timer); worker?.terminate(); worker = null; }
}
async function ensureViewer() {
  if (viewerReady) return viewerReady;
  viewerReady = (async () => {
    viewer = new NiiVue({ isDragDropEnabled: false, backgroundColor: [0.04, 0.06, 0.08, 1] });
    await viewer.attachTo('gl1');
    viewer.multiplanarType = MULTIPLANAR_TYPE.GRID;
    viewer.sliceType = SLICE_TYPE.MULTIPLANAR;
    viewer.showRender = SHOW_RENDER.ALWAYS;
    viewer.isLegendVisible = false;
    viewer.createExtensionContext().on('locationChange', (e) => { $('location').textContent = e.detail.string; });
    return viewer;
  })();
  return viewerReady;
}
async function show() {
  $('emptyState').hidden = true;
  $('resultBadge').hidden = !output;
  $('imageLabel').textContent = output ? 'ORIGINAL IMAGE · FREESURFER LABELS' : 'ORIGINAL IMAGE';
  const volumes = [{ url: source, name: source.name }];
  // freesurfer is NiiVue's built-in FreeSurfer label LUT (dist/luts/freesurfer.json).
  if (output) volumes.push({ url: output, name: output.name, colormap: 'freesurfer', opacity: Number($('opacity').value) });
  try { const nv = await ensureViewer(); await nv.loadVolumes(volumes); $('viewerError').hidden = true; }
  catch (error) {
    $('viewerError').hidden = false;
    $('viewerError').textContent = `Visualization unavailable: ${error.message}. Processing and NIfTI download remain available.`;
  }
}
async function load(file, exampleId = '') {
  if (busy || !file) return false;
  setBusy(true);
  try {
    if (!/\.nii(\.gz)?$/i.test(file.name)) throw new Error('Choose a .nii or .nii.gz image.');
    status('Reading image…');
    const { data, dims } = await readNifti(await file.arrayBuffer());
    source = file; output = null; provenance = null;
    $('outputSection').open = false;
    loadedExample = exampleId; $('exampleSelect').value = exampleId;
    $('ct').checked = looksLikeCt(data);
    $('progress').value = 0; $('elapsed').textContent = '';
    $('fileInfo').hidden = false;
    $('fileInfo').textContent = `${file.name} · ${dims.join(' × ')} voxels`;
    await show();
    status(webgpu ? 'Image loaded · ready to segment' : 'Image loaded · this browser cannot run SynthSeg', !webgpu);
    return true;
  } catch (error) { status(error.message, true); return false; }
  finally { setBusy(false); }
}
async function importImages(filesPromise) {
  if (busy) return;
  const controller = new AbortController();
  importAbort = controller;
  setBusy(true); status('Reading images · converting DICOM if needed…');
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
    if (!controller.signal.aborted) { setBusy(false); status(error.message, true); }
  } finally {
    if (importAbort === controller) importAbort = null;
  }
}
$('imageInput').onchange = () => {
  const files = Array.from($('imageInput').files);
  $('imageInput').value = '';
  if (files.length) void importImages(Promise.resolve(files));
};
$('seriesSelect').onchange = async () => {
  if (!await load(importedImages[Number($('seriesSelect').value)])) $('seriesSelect').value = String(importedImages.indexOf(source));
};
$('dropZone').ondragover = (e) => { e.preventDefault(); $('dropZone').classList.add('dragging'); };
$('dropZone').ondragleave = () => $('dropZone').classList.remove('dragging');
$('dropZone').ondrop = (e) => {
  e.preventDefault(); $('dropZone').classList.remove('dragging');
  if (!busy) void importImages(e.dataTransfer.items?.length ? filesFromDataTransferItems(e.dataTransfer.items) : Promise.resolve(Array.from(e.dataTransfer.files)));
};
$('exampleSelect').onchange = async () => {
  if (!$('exampleSelect').value || busy) return;
  const id = $('exampleSelect').value;
  setBusy(true); status(`Downloading ${id}…`);
  const controller = new AbortController();
  exampleAbort = controller;
  try {
    const response = await fetch(exampleURL, { signal: controller.signal });
    if (!response.ok) throw new Error('Example download failed. You can load a local NIfTI image instead.');
    const bytes = await response.arrayBuffer();
    if (controller.signal.aborted) return;
    setBusy(false);
    if (await load(new File([bytes], `${id}.nii.gz`), id)) $('seriesSelect').hidden = true;
  } catch (error) { if (error.name !== 'AbortError') { setBusy(false); status(error.message, true); } }
  finally { if (exampleAbort === controller) { exampleAbort = null; $('exampleSelect').value = loadedExample; } }
};
$('opacity').oninput = () => { if (output && viewer) viewer.setOpacity(1, Number($('opacity').value)); };
$('processButton').onclick = () => {
  if (!source || busy || !webgpu) return;
  output = null; provenance = null;
  $('outputSection').open = false; $('resultBadge').hidden = true;
  void show();
  const options = { fast: $('mode').value === 'fast', ct: $('ct').checked };
  setBusy(true);
  $('progress').value = 0;
  started = performance.now();
  timer = setInterval(() => { $('elapsed').textContent = `${Math.round((performance.now() - started) / 1000)} s`; }, 1000);
  worker = new Worker(new URL('./inference-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = async ({ data }) => {
    if (data.type === 'progress') { status(data.message); $('progress').value = data.value; }
    if (data.type === 'error') { setBusy(false); status(data.message, true); }
    if (data.type === 'result') {
      provenance = data.provenance;
      output = new File([data.buffer], `${outputStem(source.name)}_synthseg.nii.gz`, { type: 'application/gzip' });
      setBusy(false);
      $('outputSection').open = true;
      $('progress').value = 1;
      await show();
      status(`Labels ready · ${provenance.outputShape.join(' × ')} · ${Math.round(provenance.seconds)} s`);
    }
  };
  worker.onerror = (e) => { setBusy(false); status(`Processing stopped: ${e.message || 'The inference worker could not run. Reload the app and try again.'}`, true); };
  const asset = manifest.assets.find((entry) => entry.filename === 'synthseg-2.0.onnx');
  worker.postMessage({ file: source, options, model: { ...asset, url: `${assetBase}${asset.filename}?sha256=${asset.sha256}` } });
};
$('cancelBtn').onclick = () => {
  exampleAbort?.abort(); importAbort?.abort(); setBusy(false);
  $('progress').value = 0;
  status('Processing cancelled. Your original image is unchanged.');
};
$('saveBtn').onclick = () => output && downloadFile(output);
$('reportBtn').onclick = () => provenance && downloadBlob(new Blob([JSON.stringify(provenance, null, 2)], { type: 'application/json' }), output.name.replace(/\.nii\.gz$/, '.json'));
$('aboutBtn').onclick = () => $('aboutDialog').showModal();
$('citeBtn').onclick = () => $('citeDialog').showModal();
$('privacyBtn').onclick = () => $('privacyDialog').showModal();
$('standaloneBtn').onclick = () => $('standaloneDialog').showModal();
$('copyLogBtn').onclick = () => void technicalLog.copyToClipboard();
$('clearLogBtn').onclick = () => technicalLog.clear();
if (!webgpu) status('This browser does not support WebGPU. SynthSeg needs WebGPU; try Chrome, Edge, or Safari 26 on a desktop.', true);
window.addEventListener('pagehide', () => { exampleAbort?.abort(); importAbort?.abort(); worker?.terminate(); clearInterval(timer); });
