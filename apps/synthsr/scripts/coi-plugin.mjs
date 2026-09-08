import { readFile } from 'node:fs/promises';

// GitHub Pages cannot set COOP/COEP headers. Reuse the site's scoped fallback.
export function isolationFallback() {
  let base;
  const source=()=>readFile(new URL('../../../packages/runtime-support/src/coi-serviceworker.js',import.meta.url),'utf8');
  return {
    name:'synthsr-isolation-fallback',
    configResolved(config){base=config.base;},
    async generateBundle(){this.emitFile({type:'asset',fileName:'coi-serviceworker.js',source:await source()});},
    transformIndexHtml:{order:'post',handler:()=>[{tag:'script',attrs:{src:base+'coi-serviceworker.js'},injectTo:'head-prepend'}]},
    configureServer(server){server.middlewares.use(async(req,res,next)=>{
      if(req.url?.split('?')[0]!==base+'coi-serviceworker.js')return next();
      try{res.setHeader('Content-Type','application/javascript');res.end(await source());}catch(error){next(error);}
    });},
  };
}
