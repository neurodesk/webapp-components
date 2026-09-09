import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test.beforeEach(async({page})=>{await page.route('**/MNI152_T1_1mm_brain.nii.gz',async route=>route.fulfill({body:await readFile(new URL('../../../packages/syncro/data/MNI152_T1_1mm_brain.nii.gz',import.meta.url))}));});
function scan(name,translation=0){
 const buffer=Buffer.alloc(352+4096);
 buffer.writeInt32LE(348,0);
 [3,16,16,16,1,1,1,1].forEach((n,i)=>buffer.writeInt16LE(n,40+i*2));
 buffer.writeInt16LE(2,70);buffer.writeInt16LE(8,72);
 for(let i=0;i<8;i++)buffer.writeFloatLE(1,76+i*4);
 buffer.writeFloatLE(352,108);buffer.writeFloatLE(1,112);
 buffer.writeInt16LE(1,254);
 for(let i=0;i<3;i++)buffer.writeFloatLE(1,280+i*20);
 buffer.writeFloatLE(translation,292);buffer.write('n+1\0',344);buffer.fill(20,352);
 return {name,mimeType:'application/octet-stream',buffer};
}
test('geometry error reveals retained accompanying controls before inference',async({page})=>{
 const modelRequests=[];page.on('request',r=>{if(r.url().includes('.onnx'))modelRequests.push(r.url());});
 await page.goto('./');
 expect(await page.evaluate(()=>crossOriginIsolated)).toBe(true);
 await page.locator('#input').setInputFiles(scan('anatomical.nii'));
 await page.locator('#additionalSection > summary').click();
 await page.locator('#additional').setInputFiles(scan('misaligned.nii',5));
 await page.locator('#type-0').selectOption('labels');
 await page.locator('#additionalSection > summary').click();
 await page.locator('#runButton').click();
 await expect(page.locator('#statusText')).toContainText('must match');
 await expect(page.locator('#additionalSection')).toHaveAttribute('open','');
 await expect(page.locator('#type-0')).toHaveValue('labels');
 await expect(page.locator('#download')).toBeDisabled();
 expect(modelRequests).toEqual([]);
});
test('cancellation restores input controls and invalid input cannot reuse an old scan',async({page})=>{
 await page.addInitScript(()=>{
  const OriginalWorker=window.Worker;
  window.Worker=class extends OriginalWorker {
   postMessage(job,...rest){window.sentBackend=job.synthsrBackend;return super.postMessage(job,...rest);}
  };
 });
 await page.goto('./');
 await page.locator('#input').setInputFiles(scan('anatomical.nii'));
 await page.getByText('Processing settings',{exact:true}).click();
 await expect(page.locator('#synthsrBackend')).toHaveValue('webgpu');
 await page.route('**/MNI152_T1_1mm_brain.nii.gz',()=>{});
 await page.locator('#runButton').click();
 await expect(page.locator('#synthsrBackend')).toBeDisabled();
 expect(await page.evaluate(()=>window.sentBackend)).toBe('webgpu');
 await page.locator('#cancel').click();
 await expect(page.locator('#statusText')).toContainText('cancelled');
 await expect(page.locator('#input')).toBeEnabled();
 await expect(page.locator('#synthsrBackend')).toBeEnabled();
 await expect(page.locator('#synthsrBackend')).toHaveValue('webgpu');
 await expect(page.locator('#download')).toBeDisabled();
 await page.locator('#input').setInputFiles({name:'broken.nii',mimeType:'application/octet-stream',buffer:Buffer.from('not a NIfTI')});
 await expect(page.locator('#runButton')).toBeDisabled();
});
