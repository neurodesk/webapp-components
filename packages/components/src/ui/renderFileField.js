import { createElement } from '../core/dom.js';
import { filesFromDataTransferItems } from '../file-io/detectFiles.js';

const UPLOAD_ICON = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>';

/**
 * The shared scan picker: one compact dashed drop zone wrapping a native
 * multi-file input (QSMbly's `file-upload-zone`). Scan inputs get
 * `data-neurodesk-input="image"`, `multiple` and no `accept` filter so
 * extensionless DICOM instances stay selectable.
 *
 *   const field = renderFileField({ id: 'imageInput', text: 'Drop NIfTI or DICOM files' });
 *   field.onFiles(files => …);   // picker change and drag-and-drop, folders expanded
 */
export function renderFileField(config = {}, doc = globalThis.document) {
  const input = createElement('input', {
    type: 'file',
    id: config.id,
    name: config.name,
    multiple: config.multiple !== false,
    accept: config.accept,
    'aria-label': config.label || config.text,
    'data-neurodesk-input': config.kind || 'image',
    ownerDocument: doc,
  });
  if (config.directory) {
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }
  const text = createElement('span', { className: 'nd-file-text', html: config.html, text: config.html ? undefined : (config.text || 'Drop NIfTI or DICOM files'), ownerDocument: doc });
  const root = createElement('label', { className: 'nd-file', id: config.rootId, ownerDocument: doc }, [input]);
  // SVG must be created in its namespace to render.
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = UPLOAD_ICON;
  root.append(svg, text);
  const drop = bindFileDrop(root, null, doc);
  return {
    root,
    input,
    text,
    onFiles(handler) {
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length) handler(Promise.resolve(files));
      });
      drop.handler = handler;
      return this;
    },
    setText(value) { text.textContent = value; },
    setHasFiles(value) { root.classList.toggle('has-files', Boolean(value)); },
  };
}

/**
 * Make any element a drop target. `handler` receives a promise of File[]
 * with dropped folders expanded, so DICOM directories arrive as one series.
 */
export function bindFileDrop(target, handler, doc = globalThis.document) {
  const state = { handler };
  target.addEventListener('dragover', (event) => {
    event.preventDefault();
    target.classList.add('dragover');
  });
  target.addEventListener('dragleave', () => target.classList.remove('dragover'));
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    target.classList.remove('dragover');
    if (!state.handler) return;
    const transfer = event.dataTransfer;
    const files = transfer?.items?.length
      ? filesFromDataTransferItems(transfer.items)
      : Promise.resolve(Array.from(transfer?.files || []));
    state.handler(files);
  });
  return state;
}
