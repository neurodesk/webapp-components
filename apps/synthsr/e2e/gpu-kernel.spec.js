import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Independent scalar reference checks boundaries, channel/reduction tails,
// non-cubic inputs, the single-channel input layer, and fused ELU.
test('blocked FP32 Conv3D matches an independent CPU convolution',async({page})=>{
  await page.goto('./');
  test.skip(!await page.evaluate(async()=>!!await navigator.gpu?.requestAdapter()),'No WebGPU adapter');
  const source=(await readFile(new URL('../../../packages/runtime-support/src/gpu-unet/conv3d.js',import.meta.url),'utf8')).replaceAll('export function','function');
  const result=await page.evaluate(async(source)=>{
    const body=async()=>{
      const adapter=await navigator.gpu.requestAdapter(),device=await adapter.requestDevice();
      const cases=[{dims:[5,7,9],ci:3,co:12,kernel:3,elu:false,bias:true},
        {dims:[3,4,5],ci:1,co:24,kernel:3,elu:true,bias:true},
        {dims:[4,3,5],ci:24,co:48,kernel:3,elu:false,bias:false},
        {dims:[3,2,7],ci:4,co:8,kernel:1,elu:false,bias:true}];
      const results=[];
      try {
        for(const {dims,ci,co,kernel,elu,bias} of cases) {
          const n=dims.reduce((a,b)=>a*b,1),taps=kernel**3;
          const iv=Float32Array.from({length:n*ci},(_,i)=>((i*17%101)-50)/50);
          const wv=Float32Array.from({length:co*ci*taps},(_,i)=>((i*13%97)-48)/4800);
          const bv=Float32Array.from({length:co},(_,i)=>i/100);
          const buffers=[];
          const buffer=(size,usage)=>{const b=device.createBuffer({size:Math.max(16,size),usage});buffers.push(b);return b;};
          const upload=(v)=>{const b=buffer(v.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(b,0,v);return b;};
          const input=upload(iv),weights=upload(packConvWeights(wv,[co,ci,kernel,kernel,kernel])),biasBuffer=upload(bv);
          const output=buffer(n*co*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),read=buffer(n*co*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
          const module=device.createShaderModule({code:conv3dShader({dims,inputChannels:ci,outputChannels:co,kernel,elu,bias})});
          const layout=device.createBindGroupLayout({entries:[0,1,2,3].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===3?'storage':'read-only-storage'}}))});
          const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'main'}});
          const bind=device.createBindGroup({layout,entries:[input,weights,biasBuffer,output].map((b,binding)=>({binding,resource:{buffer:b}}))});
          const e=device.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,bind);p.dispatchWorkgroups(...conv3dDispatch(dims,co));p.end();e.copyBufferToBuffer(output,0,read,0,n*co*4);device.queue.submit([e.finish()]);
          await read.mapAsync(GPUMapMode.READ);
          const actual=new Float32Array(read.getMappedRange());let maxError=0;
          for(let o=0;o<actual.length;o++) {
            const c=o%co,pos=Math.floor(o/co),z=pos%dims[2],y=Math.floor(pos/dims[2])%dims[1],x=Math.floor(pos/(dims[1]*dims[2])),pad=Math.floor(kernel/2);
            let expected=bias?bv[c]:0;
            for(let ch=0;ch<ci;ch++)for(let kx=0;kx<kernel;kx++)for(let ky=0;ky<kernel;ky++)for(let kz=0;kz<kernel;kz++) {
              const xx=x+kx-pad,yy=y+ky-pad,zz=z+kz-pad;
              if(xx>=0&&yy>=0&&zz>=0&&xx<dims[0]&&yy<dims[1]&&zz<dims[2])expected+=iv[((xx*dims[1]+yy)*dims[2]+zz)*ci+ch]*wv[(c*ci+ch)*taps+(kx*kernel+ky)*kernel+kz];
            }
            if(elu&&expected<0)expected=Math.exp(expected)-1;
            if(!Number.isFinite(actual[o]))throw new Error('Non-finite convolution output');
            maxError=Math.max(maxError,Math.abs(actual[o]-expected));
          }
          read.unmap();buffers.forEach(b=>b.destroy());results.push({dims,ci,co,kernel,elu,bias,maxError});
        }
        return results;
      }finally{device.destroy();}
    };
    const url=URL.createObjectURL(new Blob([source,`\n(${body.toString()})().then(result=>postMessage({result}),error=>postMessage({error:error.stack}));`],{type:'text/javascript'}));
    const worker=new Worker(url,{type:'module'});
    try{return await new Promise((resolve,reject)=>{worker.onmessage=({data})=>data.error?reject(new Error(data.error)):resolve(data.result);worker.onerror=e=>reject(new Error(e.message));});}
    finally{worker.terminate();URL.revokeObjectURL(url);}
  },source);
  expect(result).toHaveLength(4);
  for(const c of result)expect(c.maxError,JSON.stringify(c)).toBeLessThan(2e-6);
});
