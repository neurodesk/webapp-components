// Full production-browser run on the real scan; intentionally separate from smoke tests.
import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const [url,work,cache,out]=process.argv.slice(2);
if(!out)throw new Error('Usage: browser-run.mjs URL work-directory model-cache output-directory');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(url);
 await expect.poll(()=>page.evaluate(()=>crossOriginIsolated)).toBe(true);
 await page.locator('#input').setInputFiles(work+'/sub-01_T1w.nii.gz');
 await expect(page.locator('#runButton')).toBeEnabled();
 await page.getByText('Processing settings',{exact:true}).click();
 await page.locator('#localSr').setInputFiles(cache+'/276151128c666f81eba80a6afb7f307aa3c7d58825748029ba67cf170f1460a3/synthsr.onnx');
 await page.getByText('Processing settings',{exact:true}).click();
 await page.locator('#additionalSection > summary').click();
 await page.locator('#additional').setInputFiles([work+'/binary.nii.gz',work+'/labels.nii.gz']);
 await page.locator('#type-0').selectOption('binary');await page.locator('#type-1').selectOption('labels');
 await page.locator('#additionalSection > summary').click();
 await page.screenshot({path:out+'/desktop-input.png',fullPage:true});
 const start=Date.now();await page.locator('#runButton').click();
 let previous='';
 for(;;){
  const status=await page.locator('#statusText').textContent();
  if(status!==previous){console.log(status);previous=status;}
  if(status.includes('Normalization complete'))break;
  if(await page.locator('#cancel').isHidden())throw new Error('Processing stopped: '+status);
  if(Date.now()-start>30*60*1000)throw new Error('Full scan exceeded 30 minutes.');
  await page.waitForTimeout(1000);
 }
 await expect(page.locator('#results')).toHaveAttribute('open','');
 await expect(page.locator('#viewerError')).toBeHidden();
 await page.locator('#opacity').evaluate(el=>{el.value='0.75';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.waitForTimeout(2000);
 await expect(page.locator('#viewerError')).toBeHidden();
 await page.screenshot({path:out+'/desktop-result.png',fullPage:true});
 const download=page.waitForEvent('download');await page.locator('#download').click();
 await (await download).saveAs(out+'/syncro-results.zip');
 await writeFile(out+'/browser.json',JSON.stringify({seconds:(Date.now()-start)/1000,browser:browser.version(),errors,annotations:'Synthetic fixtures on the real anatomical grid'},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Browser result downloaded',out);
}finally{await browser.close();}
