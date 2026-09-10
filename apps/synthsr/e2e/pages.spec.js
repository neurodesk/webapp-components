import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';

// GitHub Pages serves static files without custom COOP/COEP response headers.
test('GitHub Pages fallback isolates the page and its processing worker',async({page})=>{
  const dist=fileURLToPath(new URL('../dist/',import.meta.url));
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(!path.startsWith('/synthsr/')){res.writeHead(404);res.end();return;}
    try {
      const relative=path.slice('/synthsr/'.length)||'index.html';
      const data=await readFile(join(dist,relative));
      const type={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.css':'text/css'}[extname(relative)]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':type});res.end(data);
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const response=await page.goto(`http://127.0.0.1:${server.address().port}/synthsr/`);
    expect(response.headers()['cross-origin-opener-policy']).toBeUndefined();
    await page.waitForFunction(()=>crossOriginIsolated===true,{},{timeout:30000});
    const worker=await page.evaluate(()=>new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(new Blob(['postMessage({isolated:crossOriginIsolated,shared:typeof SharedArrayBuffer})'],{type:'application/javascript'}));
      const w=new Worker(url);w.onmessage=e=>{w.terminate();URL.revokeObjectURL(url);resolve(e.data);};w.onerror=reject;
    }));
    expect(worker).toEqual({isolated:true,shared:'function'});
    await page.getByRole('button',{name:'Standalone'}).click();await expect(page.locator('#standaloneDialog')).toBeVisible();
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
