import NiiVue, { MULTIPLANAR_TYPE, SLICE_TYPE, SHOW_RENDER } from '@niivue/niivue';
import { mountImagingWorkspace } from '@neurodesk/webapp-components/core/mount-imaging-workspace';
import { bindFileDrop, bindInfoTooltips, createInfoDialog, renderConsole, renderViewerToolbar } from '@neurodesk/webapp-components/ui';
import { createElement } from '@neurodesk/webapp-components/core';
import { readVolume } from '@neurodesk/synthsr';
import { readImageFiles } from '@neurodesk/runtime-support/dcm2niix-client';
import { zipSync } from 'fflate';
import { templateAsset } from '../../../packages/syncro/src/assets.js';
import './styles.css';

mountImagingWorkspace({
  controls: '#controls',
  viewer: '#viewer',
  status: '#status',
  title: 'SYNcro',
  subtitle: 'Normalize brain scans and aligned lesion maps to MNI space',
  mark: 'S',
  controlsContract: { about: '#aboutBtn', privacy: '#privacyBtn', standalone: '#standaloneBtn' },
});

const $ = (id) => document.getElementById(id);
const base = new URL(import.meta.env.BASE_URL, location.href);
const viewerRegion = $('viewer');

// ---- Shared chrome: layout tabs + overlay opacity, technical log, information dialog ----
const layouts = {
  multiplanar: () => { viewer.sliceType = SLICE_TYPE.MULTIPLANAR; viewer.multiplanarType = MULTIPLANAR_TYPE.GRID; viewer.showRender = SHOW_RENDER.ALWAYS; },
  axial: () => { viewer.sliceType = SLICE_TYPE.AXIAL; },
  coronal: () => { viewer.sliceType = SLICE_TYPE.CORONAL; },
  sagittal: () => { viewer.sliceType = SLICE_TYPE.SAGITTAL; },
  render: () => { viewer.sliceType = SLICE_TYPE.RENDER; },
};
const opacityControl = createElement('label', { className: 'nd-opacity-control', id: 'opacityControl', hidden: true }, [
  'Overlay',
  createElement('input', { id: 'opacity', type: 'range', min: 0, max: 100, step: 5, value: 50, disabled: true, 'aria-label': 'Overlay opacity' }),
  createElement('span', { id: 'opacityValue', text: '50%' }),
]);
const toolbar = renderViewerToolbar({
  window: false, overlay: false, colormap: false, download: false, screenshot: false,
  actions: [opacityControl],
  views: [
    { id: 'multiplanar', label: '3-Plane', active: true },
    { id: 'axial', label: 'Axial' },
    { id: 'coronal', label: 'Coronal' },
    { id: 'sagittal', label: 'Sagittal' },
    { id: 'render', label: '3D' },
  ].map((view) => ({ ...view, onClick: () => { if (!viewer) return; layouts[view.id](); viewer.drawScene(); toolbar.setActive(view.id); } })),
});
viewerRegion.prepend(toolbar.root);
const technicalLog = renderConsole({ id: 'technicalLog', outputId: 'log', copyId: 'copyLog', clearId: 'clearLog' });
viewerRegion.append(technicalLog.root);
bindInfoTooltips(document);

const info = createInfoDialog({ id: 'info', titleId: 'infoTitle', bodyId: 'infoBody' });
$('aboutBtn').onclick = () => info.open('About SYNcro', $('aboutContent'));
$('standaloneBtn').onclick = () => info.open('Standalone', $('standaloneContent'), { wide: true });
$('privacyBtn').onclick = () => info.open('Privacy', $('privacyContent'));
info.body.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy-target]');
  if (!button) return;
  const text = info.body.querySelector(`#${button.dataset.copyTarget}`)?.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    const live = info.body.querySelector('#copyStatus');
    if (live) live.textContent = 'Copied to clipboard';
  } catch {
    status('Could not copy automatically. Select the text and copy it manually.');
  }
  setTimeout(() => { button.textContent = 'Copy'; }, 1200);
});

// ---- Workflow state ----
let source, worker, viewer, viewerReady, busy = false, outputs, additional = [], timer, start, exampleAbort, importAbort, displayed = 'original';
const status = (message, error = false) => {
  $('statusText').textContent = message;
  $('statusText').classList.toggle('error', error);
  technicalLog.log(message, error ? 'error' : 'info');
};
const log = (message) => technicalLog.log(message);

function setBusy(value) {
  busy = value;
  for (const id of ['input', 'example', 'additional', 'modality', 'synthsrBackend', 'brainExtractor']) $(id).disabled = value;
  for (const select of $('additionalList').querySelectorAll('select')) select.disabled = value;
  $('runButton').disabled = value || !source;
  $('cancel').hidden = !value;
  $('download').disabled = value || !outputs;
  for (const button of $('resultList').querySelectorAll('button')) button.disabled = value;
  if (!value) { clearInterval(timer); worker?.terminate(); worker = null; }
}

async function getViewer() {
  if (!viewerReady) {
    viewerReady = (async () => {
      viewer = new NiiVue({ isDragDropEnabled: false, backgroundColor: [0, 0, 0, 1] });
      await viewer.attachTo('gl1');
      layouts.multiplanar();
      viewer.isLegendVisible = false;
      return viewer;
    })();
  }
  return viewerReady;
}

async function show(file, overlay = false) {
  $('empty').hidden = true;
  $('viewLabel').textContent = overlay ? `MNI template + ${file.name}` : file.name;
  try {
    const nv = await getViewer();
    await nv.loadVolumes(overlay
      ? [{ url: templateAsset.url, name: 'MNI template' }, { url: file, name: file.name, opacity: Number($('opacity').value) / 100 }]
      : [{ url: file, name: file.name }]);
    $('viewerError').hidden = true;
  } catch (error) {
    $('viewerError').hidden = false;
    $('viewerError').textContent = `Viewer unavailable: ${error.message}`;
  }
}

// ---- Results list (View / Download per output) ----
const viewLabels = {
  original: 'Original acquired image',
  'synthetic-t1.nii': 'Synthetic T1',
  'synthetic-brain.nii': 'Synthetic brain',
  'brain-mask.nii': 'Brain mask',
  'warped-synthetic-brain.nii.gz': 'Warped synthetic brain',
  'warped-original.nii.gz': 'Warped acquired image',
};
function download(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderResults() {
  const names = ['original', ...Object.keys(outputs || {}).filter((name) => /\.nii(\.gz)?$/.test(name) && !name.includes('Warp'))];
  $('resultList').replaceChildren(...names.map((name) => createElement('div', { className: 'nd-volume-toggle', dataset: { result: name } }, [
    createElement('button', { type: 'button', className: `nd-view-btn${name === displayed ? ' active' : ''}`, text: 'View', disabled: !source, onclick: () => viewResult(name) }),
    createElement('span', { className: 'nd-stage-label', text: viewLabels[name] || name }),
    name === 'original' ? null : createElement('button', { type: 'button', className: 'nd-download-btn', text: 'Download', onclick: () => download(outputs[name], name) }),
  ])));
}
function updateOpacityControl(name) {
  const overlay = name.startsWith('warped-');
  $('opacityControl').hidden = !overlay;
  $('opacity').disabled = !overlay;
}
function viewResult(name) {
  displayed = name;
  updateOpacityControl(name);
  for (const row of $('resultList').querySelectorAll('.nd-volume-toggle')) row.querySelector('.nd-view-btn').classList.toggle('active', row.dataset.result === name);
  if (name === 'original') void show(source);
  else if (outputs?.[name]) void show(new File([outputs[name]], name), name.startsWith('warped-'));
}

async function load(file) {
  if (busy || !file) return;
  try {
    if (!/\.nii(\.gz)?$/i.test(file.name)) throw new Error('Choose a NIfTI image (.nii or .nii.gz).');
    const volume = readVolume(await file.arrayBuffer());
    source = file;
    outputs = null;
    displayed = 'original';
    $('results').open = false;
    $('download').disabled = true;
    renderResults();
    updateOpacityControl('original');
    $('fileInfo').hidden = false;
    $('fileInfo').innerHTML = `<strong></strong> · ${volume.dims.join(' × ')} voxels`;
    $('fileInfo').querySelector('strong').textContent = file.name;
    $('dropZone').classList.add('has-files');
    $('runButton').disabled = true;
    $('progress').value = 0;
    await show(file);
    $('runButton').disabled = false;
    status(`Ready to normalize · ${file.name}`);
  } catch (error) {
    source = null;
    $('runButton').disabled = true;
    renderResults();
    status(error.message, true);
  }
}

function setAdditional(files) {
  additional = files.map((file) => ({ file, type: 'image' }));
  $('additionalList').replaceChildren(...additional.map((item, index) => {
    const select = createElement('select', { id: `type-${index}`, 'aria-label': `Image type for ${item.file.name}` });
    for (const [value, text] of [['image', 'Continuous image'], ['binary', 'Binary lesion (0/1)'], ['labels', 'Categorical labels']]) select.add(new Option(text, value));
    select.onchange = () => { item.type = select.value; };
    return createElement('div', { className: 'nd-field' }, [createElement('label', { for: select.id, text: item.file.name }), select]);
  }));
}

async function importScans(filesPromise, primary) {
  if (busy) return;
  const controller = new AbortController();
  importAbort = controller;
  if (primary) { source = null; outputs = null; renderResults(); }
  setBusy(true);
  status('Reading images · converting DICOM if needed…');
  try {
    const files = await filesPromise;
    if (!files.length) return;
    const images = await readImageFiles(files, { signal: controller.signal });
    controller.signal.throwIfAborted();
    if (!images.length) throw new Error('Choose NIfTI files or a complete DICOM series.');
    if (primary && images.length !== 1) throw new Error('Choose one anatomical image or one DICOM series at a time.');
    if (primary) { setBusy(false); await load(images[0]); }
    else {
      for (const file of images) readVolume(await file.arrayBuffer());
      controller.signal.throwIfAborted();
      setAdditional(images);
      status('Accompanying images loaded · choose their image types');
    }
  } catch (error) {
    if (!controller.signal.aborted) status(error.message, true);
  } finally {
    if (importAbort === controller) { importAbort = null; setBusy(false); }
  }
}
// The native inputs keep their selection so reopening a section shows what was chosen.
const filesFromInput = (input) => Promise.resolve(Array.from(input.files));
$('input').onchange = () => importScans(filesFromInput($('input')), true);
$('additional').onchange = () => importScans(filesFromInput($('additional')), false);
bindFileDrop($('dropZone'), (files) => importScans(files, true));
bindFileDrop($('additional').closest('.nd-file'), (files) => importScans(files, false));

$('example').onclick = async () => {
  setBusy(true);
  status('Downloading OpenNeuro ds000001/sub-01…');
  exampleAbort = new AbortController();
  try {
    const response = await fetch(import.meta.env.VITE_SYNCRO_EXAMPLE_URL || 'https://s3.amazonaws.com/openneuro.org/ds000001/sub-01/anat/sub-01_T1w.nii.gz', { signal: exampleAbort.signal });
    if (!response.ok) throw new Error('Example download failed.');
    const bytes = await response.arrayBuffer();
    setBusy(false);
    await load(new File([bytes], 'sub-01_T1w.nii.gz'));
  } catch (error) {
    setBusy(false);
    if (error.name !== 'AbortError') status(error.message, true);
  } finally {
    exampleAbort = null;
  }
};

$('runButton').onclick = () => {
  if (!source || busy) return;
  outputs = null;
  displayed = 'original';
  renderResults();
  updateOpacityControl('original');
  setBusy(true);
  status('Preparing normalization…');
  $('progress').value = 0;
  $('results').open = false;
  technicalLog.console.clear();
  start = performance.now();
  timer = setInterval(() => { $('elapsed').textContent = `${Math.round((performance.now() - start) / 1000)} s`; }, 1000);
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onerror = (event) => { status(event.message ? `Processing failed: ${event.message}` : 'Could not load the processing worker. Reload the page and try again.', true); setBusy(false); };
  const stageRanges = { synthsr: [0, 0.45], mindgrab: [0.45, 0.25], synthstrip: [0.45, 0.25], registration: [0.7, 0.25], resampling: [0.95, 0.05], complete: [1, 0] };
  const stageLabels = { synthsr: 'Synthesizing T1…', mindgrab: 'Extracting brain with MindGrab…', synthstrip: 'Extracting brain with SynthStrip…', registration: 'Registering to MNI…', resampling: 'Warping original images…' };
  worker.onmessage = ({ data }) => {
    if (data.type === 'log') { log(data.message); return; }
    if (data.type === 'error') {
      if (/Accompanying|Binary lesion|Label images/.test(data.message)) $('additionalSection').open = true;
      status(data.message, true);
      setBusy(false);
      return;
    }
    if (data.type === 'progress') {
      const [offset, span] = stageRanges[data.stage] || [0, 0];
      if (data.value !== null) $('progress').value = offset + span * data.value;
      status(data.message || stageLabels[data.stage] || data.stage);
      return;
    }
    if (data.type === 'result') {
      outputs = data.outputs;
      setBusy(false);
      $('progress').value = 1;
      status('Normalization complete · review the MNI alignment');
      $('results').open = true;
      renderResults();
      viewResult('warped-original.nii.gz');
    }
  };
  worker.postMessage({
    input: source,
    additional,
    ct: $('modality').value === 'ct',
    synthsrBackend: $('synthsrBackend').value,
    brainExtractor: $('brainExtractor').value,
    modelBase: import.meta.env.VITE_SYNCRO_MODEL_BASE,
    mindgrabAssetPath: new URL('mindgrab/', base).href,
    templateURL: templateAsset.url,
    registrationURL: new URL('registration/syncro-registration.mjs', base).href,
  });
};

$('cancel').onclick = () => {
  importAbort?.abort();
  importAbort = null;
  exampleAbort?.abort();
  setBusy(false);
  status('Processing cancelled');
  $('progress').value = 0;
};

$('opacity').oninput = () => {
  $('opacityValue').textContent = `${$('opacity').value}%`;
  if (viewer?.volumes.length > 1) { viewer.volumes[1].opacity = Number($('opacity').value) / 100; viewer.updateGLVolume(); }
};
$('download').onclick = () => { if (outputs) download(zipSync(outputs, { level: 1 }), 'syncro-results.zip', 'application/zip'); };

renderResults();
window.addEventListener('pagehide', () => { importAbort?.abort(); worker?.terminate(); exampleAbort?.abort(); clearInterval(timer); });
