import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {readVolume} from '../src/volume.js';
const fixture=(name)=>fileURLToPath(new URL('../test/fixtures/'+name,import.meta.url));

test('load, invalid input, and cancellation preserve the original',async({page})=>{
  await page.goto('./');await expect(page).toHaveTitle(/SynthSR/);
  await expect(page.locator('#processButton')).toBeDisabled();
  await page.locator('#imageInput').setInputFiles({name:'bad.nii',mimeType:'application/octet-stream',buffer:Buffer.from('not a nifti')});
  await expect(page.locator('#statusText')).toHaveClass(/error/);
  await page.locator('#imageInput').setInputFiles(fixture('validation.nii.gz'));
  await expect(page.locator('#processButton')).toBeEnabled();
  // Hold the model request so this tests real cancellation without a giant asset.
  await page.route('**/synthsr-v2.onnx*',()=>{});
  await page.locator('#processButton').click();await page.locator('#cancelBtn').click();
  await expect(page.locator('#statusText')).toContainText('cancelled');
  await expect(page.locator('#saveBtn')).toBeDisabled();
  await expect(page.locator('#processButton')).toBeEnabled();
  await page.locator('#aboutBtn').click();await expect(page.locator('#aboutDialog')).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('#standaloneBtn').click();
  await expect(page.locator('#standaloneDialog')).toBeVisible();
  await expect(page.locator('#standaloneDialog')).toContainText('SLURM_CPUS_PER_TASK');
  const packageDownload=page.waitForEvent('download');await page.locator('#standalonePackage').click();
  expect((await packageDownload).suggestedFilename()).toBe('neurodesk-synthsr-0.1.0.tgz');
  await page.locator('#standaloneDialog').getByRole('button',{name:'Close',exact:true}).click();
});

test('full-volume WebGPU regression with default augmentation',async({page})=>{
  test.skip(!process.env.SYNTHSR_FULL_INPUT || !process.env.SYNTHSR_FULL_REFERENCE,
    'Set SYNTHSR_FULL_INPUT and SYNTHSR_FULL_REFERENCE to run on a capable hardware GPU.');
  test.setTimeout(900000);
  await page.goto('./');
  await page.locator('#imageInput').setInputFiles(process.env.SYNTHSR_FULL_INPUT);
  await expect(page.locator('#processButton')).toBeEnabled();
  await page.locator('#processingSettings > summary').click();
  await page.locator('#backend').selectOption('webgpu');
  await page.locator('#processButton').click();
  await expect(page.locator('#saveBtn')).toBeEnabled({timeout:840000});
  const pending=page.waitForEvent('download');await page.locator('#saveBtn').click();
  const bytes=await readFile(await (await pending).path());
  const output=readVolume(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const ref=await readFile(process.env.SYNTHSR_FULL_REFERENCE);
  const expected=readVolume(ref.buffer.slice(ref.byteOffset,ref.byteOffset+ref.byteLength));
  expect(output.dims).toEqual(expected.dims);
  let max=0,mismatches=0;
  for(let i=0;i<output.data.length;i++){
    const delta=Math.abs(output.data[i]-expected.data[i]);max=Math.max(max,delta);mismatches+=delta!==0;
  }
  expect(max).toBeLessThanOrEqual(1);
  expect(mismatches/output.data.length).toBeLessThan(.001);
  for(let r=0;r<3;r++)for(let c=0;c<4;c++)expect(Math.abs(output.affine[r][c]-expected.affine[r][c])).toBeLessThan(2e-5);
});

for(const backend of ['wasm','webgpu']) test(`real ${backend} inference matches TensorFlow and downloads provenance`,async({page})=>{
  test.skip(!process.env.SYNTHSR_ASSET_DIR,'Set SYNTHSR_ASSET_DIR to the converted pretrained model for inference parity.');
  await page.goto('./');
  if(backend==='webgpu') {
    const gpu=await page.evaluate(async()=>!!(await navigator.gpu?.requestAdapter()));
    test.skip(!gpu,'This browser has no WebGPU adapter.');
  }
  await page.locator('#imageInput').setInputFiles(fixture('validation.nii.gz'));
  await expect(page.locator('#processButton')).toBeEnabled();
  await page.locator('#processingSettings > summary').click();
  await page.locator('#backend').selectOption(backend);await page.locator('#processButton').click();
  await expect(page.locator('#saveBtn')).toBeEnabled({timeout:240000});
  const downloadPromise=page.waitForEvent('download');await page.locator('#saveBtn').click();const download=await downloadPromise;
  const bytes=await readFile(await download.path());const output=readVolume(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const r=await readFile(fixture('validation-reference.nii.gz'));const expected=readVolume(r.buffer.slice(r.byteOffset,r.byteOffset+r.byteLength));
  expect(output.dims).toEqual([32,32,32]);let mismatches=0,maxError=0;
  for(let i=0;i<output.data.length;i++){maxError=Math.max(maxError,Math.abs(output.data[i]-expected.data[i]));mismatches+=output.data[i]!==expected.data[i];}
  expect(maxError).toBeLessThanOrEqual(1);
  expect(mismatches/output.data.length).toBeLessThan(.001);
  const reportPromise=page.waitForEvent('download');await page.locator('#reportBtn').click();const report=JSON.parse(await readFile(await (await reportPromise).path(),'utf8'));
  expect(report.backend).toBe(backend);expect(report.synthetic).toBe(true);expect(report.flip).toBe(true);expect(report.modelSha256).toMatch(/^[a-f0-9]{64}$/);
  if(backend==='webgpu')expect(report.gpuImplementation).toBe('synthsr-blocked-fp32-v1');
  else expect(report.onnxRuntime).toBe('1.29.0');
  await page.locator('#inputTab').click();await expect(page.locator('#resultBadge')).toBeHidden();
});
