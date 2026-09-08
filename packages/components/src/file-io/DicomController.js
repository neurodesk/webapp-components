import { isNiftiFile, filesFromDataTransferItems } from './detectFiles.js';

export async function readSingleImage(files, options = {}) {
  const list = Array.from(files || []).filter(file => !/\.(json|bval|bvec)$/i.test(file.name));
  if (!list.length) return null;
  if (list.length === 1 && isNiftiFile(list[0])) return list[0];
  if (list.some(isNiftiFile)) throw new Error('Choose one NIfTI image or one DICOM series for this field.');
  return new DicomController({ ...options, requireSingle: true }).convertFiles(list);
}

export class DicomController {
  constructor(options = {}) {
    this.moduleUrl = options.moduleUrl || '../../dcm2niix/index.js';
    this.updateOutput = options.updateOutput || (() => {});
    this.onConversionComplete = options.onConversionComplete || (() => {});
    this.onDicomFiles = options.onDicomFiles || null;
    this.throwOnError = options.throwOnError ?? true;
    this.requireSingle = options.requireSingle ?? false;
    this.dcm2niixModule = null;
    this.converting = false;
  }

  async convertFiles(files) {
    const inputFiles = Array.from(files || []);
    if (!inputFiles.length) return null;
    this.converting = true;
    this.updateOutput(`Converting ${inputFiles.length} DICOM files...`);
    let dcm2niix;
    try {
      if (this.onDicomFiles) await this.onDicomFiles(inputFiles);
      dcm2niix = await this._createInstance();
      const result = await dcm2niix.input(inputFiles).run();
      const output = this._selectNifti(result);
      await this.onConversionComplete(output, result);
      return output;
    } catch (error) {
      this.updateOutput(`DICOM conversion failed: ${error.message}`);
      if (this.throwOnError) throw error;
      return null;
    } finally {
      dcm2niix?.worker?.terminate();
      this.converting = false;
    }
  }

  async convertDropItems(items) {
    const files = await filesFromDataTransferItems(items);
    if (!files.length) {
      if (items?.length) this.updateOutput('No DICOM files found in dropped items.');
      return null;
    }
    return this.convertFiles(files);
  }

  async _createInstance() {
    if (!this.dcm2niixModule) this.dcm2niixModule = await import(this.moduleUrl);
    const dcm2niix = new this.dcm2niixModule.Dcm2niix();
    await dcm2niix.init();
    return dcm2niix;
  }

  _selectNifti(resultFiles) {
    const niftiFiles = Array.from(resultFiles || []).filter(isNiftiFile);
    if (!niftiFiles.length) throw new Error('No NIfTI files produced. Are these valid DICOM files?');
    if (this.requireSingle && niftiFiles.length > 1) throw new Error('Several DICOM series found. Select the files for one series at a time.');
    this.updateOutput(`Converted ${niftiFiles.length} NIfTI file(s). Using: ${niftiFiles[0].name}`);
    return niftiFiles[0];
  }
}
