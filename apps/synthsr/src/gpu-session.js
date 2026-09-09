import model from './gpu-model.json' with { type: 'json' };
import { conv3dShader, conv3dDispatch, packConvWeights } from './gpu-conv3d.js';

export const GPU_IMPLEMENTATION = 'synthsr-blocked-fp32-v1';
const product = (dims) => dims.reduce((a,b)=>a*b,1);
const same = (a,b) => a.join() === b.join();

// This executor deliberately accepts only the checksum-pinned SynthSR graph.
// Keeping all intermediates NDHWC avoids per-layer layout conversions. No image
// patches or reduced-precision arithmetic are introduced here.
export function planGpuGraph(dims, graph = model) {
  if (dims.length !== 3 || dims.some(d=>!Number.isSafeInteger(d) || d<32 || d%32)) {
    throw new Error('SynthSR GPU dimensions must be positive multiples of 32.');
  }
  const uses = new Map([[graph.output,1]]);
  for (const node of graph.nodes) for (const input of node.inputs) uses.set(input,(uses.get(input)||0)+1);
  const tensors = new Map([[graph.input,{dims:[...dims],channels:1}]]), nodes=[];
  const aliases = new Map();
  const resolve = (name) => aliases.get(name) || name;
  for (let i=0;i<graph.nodes.length;i++) {
    const source=graph.nodes[i], node={...source,inputs:source.inputs.map(resolve),elu:false};
    const input=tensors.get(node.inputs[0]);
    if (!input) throw new Error(`Missing GPU graph input: ${node.inputs[0]}`);
    if (node.op==='Identity') { aliases.set(node.output,resolve(node.inputs[0]));continue; }
    let shape={dims:[...input.dims],channels:input.channels};
    if (node.op==='Conv') {
      const weight=graph.tensors[node.inputs[1]], [co,ci,...kernel]=weight.dims;
      if (ci!==input.channels || !same(kernel,[kernel[0],kernel[0],kernel[0]]) || ![1,3].includes(kernel[0]) ||
          (co!==1 && co%4) || (co===1 && kernel[0]!==1) ||
          (node.attrs.group??1)!==1 || !same(node.attrs.dilations??[1,1,1],[1,1,1]) ||
          (node.attrs.auto_pad??'NOTSET')!=='NOTSET' ||
          !same(node.attrs.strides,[1,1,1]) || !same(node.attrs.pads,Array(6).fill(Math.floor(kernel[0]/2)))) {
        throw new Error(`Unsupported SynthSR convolution: ${node.name}`);
      }
      shape.channels=co;node.kernel=kernel[0];
    } else if (node.op==='MaxPool') {
      if (!same(node.attrs.kernel_shape,[2,2,2]) || !same(node.attrs.strides,[2,2,2]) ||
          node.attrs.auto_pad!=='SAME_UPPER' || (node.attrs.ceil_mode??0)!==0 ||
          !same(node.attrs.dilations??[1,1,1],[1,1,1])) throw new Error('Unsupported GPU pooling.');
      shape.dims=shape.dims.map(d=>d/2);
    } else if (node.op==='Resize') {
      if (node.attrs.mode!=='nearest' || node.attrs.coordinate_transformation_mode!=='asymmetric' || node.attrs.nearest_mode!=='floor') throw new Error('Unsupported GPU resize.');
      shape.dims=shape.dims.map(d=>d*2);
    } else if (node.op==='Add') {
      const other=tensors.get(node.inputs[1]);
      if (!other || other.channels!==shape.channels || !same(other.dims,shape.dims)) throw new Error('GPU Add shape mismatch.');
    } else if (node.op==='Elu') {
      if(node.attrs.alpha!==1)throw new Error('Unsupported GPU ELU.');
    } else if (node.op==='BatchNormalization') {
      if((node.attrs.training_mode??0)!==0 || node.inputs.length!==5 ||
          node.inputs.slice(1).some(name=>!same(graph.tensors[name].dims,[input.channels]))) throw new Error('Unsupported GPU batch normalization.');
    } else {
      throw new Error(`Unsupported GPU operator: ${node.op}`);
    }
    if(shape.dims.some(d=>!Number.isSafeInteger(d)||d<1))throw new Error('Unsupported GPU spatial shape.');
    const next=graph.nodes[i+1];
    if (['Conv','Add'].includes(node.op) && next?.op==='Elu' && next.inputs[0]===node.output && uses.get(node.output)===1 && next.attrs.alpha===1) {
      node.output=next.output;node.elu=true;i++;
    }
    node.inputShape=input;node.shape=shape;
    tensors.set(node.output,shape);nodes.push(node);
  }
  const output=resolve(graph.output);
  if(!tensors.has(output) || tensors.get(output).channels!==1 || !same(tensors.get(output).dims,dims))throw new Error('GPU output does not match the SynthSR contract.');
  // Assign reusable buffers by graph lifetime. Never alias an operation's input
  // and output. Skip activations survive until their decoder consumer finishes.
  const remaining=new Map([[output,1]]);
  for(const node of nodes) for(const name of node.inputs) if(tensors.has(name)) remaining.set(name,(remaining.get(name)||0)+1);
  const slots=[{bytes:product(dims)*4}], assigned=new Map([[graph.input,0]]), free=new Set();
  for(const node of nodes) {
    const bytes=product(node.shape.dims)*node.shape.channels*4;
    const candidates=[...free].filter(i=>slots[i].bytes>=bytes).sort((a,b)=>slots[a].bytes-slots[b].bytes);
    const slot=candidates[0] ?? slots.length;
    if(slot===slots.length)slots.push({bytes});else free.delete(slot);
    assigned.set(node.output,slot);node.slot=slot;
    node.inputSlots=node.inputs.map(name=>assigned.get(name));
    for(const name of node.inputs) if(remaining.has(name)) {
      const left=remaining.get(name)-1;remaining.set(name,left);
      // Input buffer is reused as an intermediate but uploaded anew each run.
      if(!left)free.add(assigned.get(name));
    }
  }
  return {nodes,slots,inputSlot:0,outputSlot:assigned.get(output),outputShape:tensors.get(output)};
}

function elementShader(node) {
  const {op,shape,inputShape}=node, [d,h,w]=shape.dims, c=shape.channels, size=d*h*w*c;
  const bindings=['input','other','params','result'].map((name,i)=>`@group(0) @binding(${i}) var<storage,${i===3?'read_write':'read'}> ${name}: array<f32>;`).join('\n');
  let body;
  if(op==='Elu')body='let x=input[i];result[i]=select(exp(x)-1.0,x,x>=0.0);';
  if(op==='Add')body=`let x=input[i]+other[i];result[i]=${node.elu?'select(exp(x)-1.0,x,x>=0.0)':'x'};`;
  if(op==='BatchNormalization')body=`let channel=i%${c}u;
    result[i]=(input[i]-params[${2*c}u+channel])/sqrt(params[${3*c}u+channel]+${node.attrs.epsilon})*params[channel]+params[${c}u+channel];`;
  if(op==='Resize') {
    const [,ih,iw]=inputShape.dims;
    body=`let channel=i%${c}u;let p=i/${c}u;
      let z=p%${w}u/2u;let y=p/${w}u%${h}u/2u;let x=p/${w*h}u/2u;
      result[i]=input[((x*${ih}u+y)*${iw}u+z)*${c}u+channel];`;
  }
  if(op==='MaxPool') {
    const [,ih,iw]=inputShape.dims;
    body=`let channel=i%${c}u;let p=i/${c}u;
      let z=(p%${w}u)*2u;let y=(p/${w}u%${h}u)*2u;let x=(p/${w*h}u)*2u;
      var value=-3.402823466e38;
      for(var dx=0u;dx<2u;dx++){for(var dy=0u;dy<2u;dy++){for(var dz=0u;dz<2u;dz++){
        value=max(value,input[(((x+dx)*${ih}u+y+dy)*${iw}u+z+dz)*${c}u+channel]);
      }}}result[i]=value;`;
  }
  if(op==='Conv') {
    if(node.kernel!==1 || c!==1)throw new Error('Unsupported scalar GPU convolution.');
    body=`var value=0.0;for(var k=0u;k<${inputShape.channels}u;k++){value+=input[i*${inputShape.channels}u+k]*other[k];}result[i]=value+params[0];`;
  }
  if(!body)throw new Error(`Missing GPU shader for ${op}.`);
  const x=Math.min(65535,Math.ceil(size/256));
  return {code:`${bindings}\n@compute @workgroup_size(256) fn main(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) tid:u32){
    let i=(group.x+group.y*${x}u)*256u+tid;if(i>=${size}u){return;} ${body}}`,dispatch:[x,Math.ceil(Math.ceil(size/256)/x),1]};
}

export async function createGpuSession(bytes, dims, { gpu=globalThis.navigator?.gpu, profile=false } = {}) {
  const raw=bytes instanceof ArrayBuffer?new Uint8Array(bytes):new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),v=>v.toString(16).padStart(2,'0')).join('');
  if(raw.byteLength!==model.bytes || hash!==model.sha256)throw new Error('GPU executor requires the validated SynthSR model.');
  const plan=planGpuGraph(dims), adapter=await gpu?.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw new Error('WebGPU is unavailable. Select CPU (WASM).');
  const largest=Math.max(...plan.slots.map(s=>s.bytes));
  if(largest>=2**31 || largest>adapter.limits.maxStorageBufferBindingSize || largest>adapter.limits.maxBufferSize) {
    throw new Error('This volume exceeds the validated GPU buffer limit. Choose tiled mode (approximate), or use native SynthSR for full-volume processing.');
  }
  const timestamps=profile && adapter.features.has('timestamp-query');
  const device=await adapter.requestDevice({requiredFeatures:timestamps?['timestamp-query']:[],requiredLimits:{
    maxBufferSize:adapter.limits.maxBufferSize,maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize,
  }});
  let failure, released=false, running=false;
  device.lost.then(info=>{if(!released)failure=new Error(`SynthSR GPU device lost: ${info.message}`);});
  device.addEventListener('uncapturederror',event=>{failure=new Error(`SynthSR GPU error: ${event.error.message}`);});
  const createBuffer=(size,usage,label)=>device.createBuffer({size:Math.max(16,size),usage,label});
  const upload=(values,label)=>{
    const buffer=createBuffer(values.byteLength,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,label);
    device.queue.writeBuffer(buffer,0,values);return buffer;
  };
  const values=(name)=>{const t=model.tensors[name];return new Float32Array(raw.slice(t.offset,t.offset+t.bytes).buffer);};
  try {
    device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');
    const buffers=plan.slots.map((s,i)=>createBuffer(s.bytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC,`SynthSR activation ${i}`));
    const dummy=upload(new Float32Array(4),'unused'), constants=new Map();
    const constant=(name,pack=false)=>{
      if(!constants.has(name))constants.set(name,upload(pack?packConvWeights(values(name),model.tensors[name].dims):values(name),name));
      return constants.get(name);
    };
    const steps=[];
    for(const node of plan.nodes) {
      let shader,other=dummy,params=dummy;
      if(node.op==='Conv') {
        other=constant(node.inputs[1],node.shape.channels!==1);
        if(node.inputs[2])params=constant(node.inputs[2]);
        shader=node.shape.channels===1?elementShader(node):{
          code:conv3dShader({dims:node.shape.dims,inputChannels:node.inputShape.channels,outputChannels:node.shape.channels,kernel:node.kernel,bias:!!node.inputs[2],elu:node.elu}),
          dispatch:conv3dDispatch(node.shape.dims,node.shape.channels),
        };
      } else {
        if(node.op==='Resize' && (node.inputs[1]!=='' || !same([...values(node.inputs[2])],[1,1,2,2,2])))throw new Error('Unsupported GPU resize scales.');
        shader=elementShader(node);
        if(node.op==='Add')other=buffers[node.inputSlots[1]];
        if(node.op==='BatchNormalization') {
          const data=new Float32Array(node.shape.channels*4);
          for(let i=0;i<4;i++)data.set(values(node.inputs[i+1]),i*node.shape.channels);
          params=upload(data,node.name);
        }
      }
      // Explicit binding layout keeps unused placeholders legal after shader optimization.
      const layout=device.createBindGroupLayout({entries:[0,1,2,3].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding===3?'storage':'read-only-storage'}}))});
      const module=device.createShaderModule({label:node.name,code:shader.code});
      const pipeline=await device.createComputePipelineAsync({label:node.name,layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'main'}});
      const bind=device.createBindGroup({layout,entries:[buffers[node.inputSlots[0]],other,params,buffers[node.slot]].map((buffer,binding)=>({binding,resource:{buffer}}))});
      steps.push({name:node.name,op:node.op,pipeline,bind,dispatch:shader.dispatch});
    }
    const validation=await device.popErrorScope(),oom=await device.popErrorScope();
    if(validation||oom)throw new Error((validation||oom).message);
    const outputBytes=product(dims)*4;
    const read=createBuffer(outputBytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'SynthSR output readback');
    const query=timestamps?device.createQuerySet({type:'timestamp',count:steps.length*2}):null;
    const querySize=steps.length*16;
    const resolve=timestamps?createBuffer(querySize,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC,'timings'):null;
    const queryRead=timestamps?createBuffer(querySize,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ,'timings readback'):null;
    const session={inputNames:[model.input],outputNames:[model.output],implementation:GPU_IMPLEMENTATION,profile:[],
      async run(feeds) {
        if(released || running || failure)throw failure||new Error('SynthSR GPU session is released or busy.');
        const tensor=feeds[model.input];
        if(!tensor || tensor.type!=='float32' || !same(tensor.dims,[1,1,...dims]))throw new Error('GPU input does not match the session shape.');
        running=true;
        device.pushErrorScope('out-of-memory');device.pushErrorScope('validation');
        try {
          const data=await tensor.getData();
          if(data.length!==product(dims))throw new Error('GPU input size mismatch.');
          device.queue.writeBuffer(buffers[plan.inputSlot],0,data);
          const encoder=device.createCommandEncoder();
          for(let i=0;i<steps.length;i++) {
            const step=steps[i],pass=encoder.beginComputePass({label:step.name,...query?{timestampWrites:{querySet:query,beginningOfPassWriteIndex:i*2,endOfPassWriteIndex:i*2+1}}:{}});
            pass.setPipeline(step.pipeline);pass.setBindGroup(0,step.bind);pass.dispatchWorkgroups(...step.dispatch);pass.end();
          }
          encoder.copyBufferToBuffer(buffers[plan.outputSlot],0,read,0,outputBytes);
          if(query){encoder.resolveQuerySet(query,0,steps.length*2,resolve,0);encoder.copyBufferToBuffer(resolve,0,queryRead,0,querySize);}
          device.queue.submit([encoder.finish()]);
          await read.mapAsync(GPUMapMode.READ);
          let output;
          try{output=new Float32Array(read.getMappedRange(0,outputBytes).slice(0));}finally{read.unmap();}
          if(query) {
            await queryRead.mapAsync(GPUMapMode.READ);
            try{const times=new BigUint64Array(queryRead.getMappedRange());session.profile=steps.map((s,i)=>({name:s.name,op:s.op,milliseconds:Number(times[i*2+1]-times[i*2])/1e6}));}finally{queryRead.unmap();}
          }
          if(failure)throw failure;
          return {[model.output]:{dims:[1,1,...dims],type:'float32',getData:async()=>output,dispose(){}}};
        } finally {
          const scopes=await Promise.allSettled([device.popErrorScope(),device.popErrorScope()]);
          running=false;
          const error=scopes.find(s=>s.status==='fulfilled'&&s.value)?.value;
          if(error)throw new Error(`SynthSR GPU inference failed: ${error.message}`);
          const rejected=scopes.find(s=>s.status==='rejected');
          if(rejected)throw rejected.reason;
        }
      },
      async release(){if(!released){released=true;device.destroy();}},
    };
    return session;
  }catch(error){released=true;device.destroy();throw error;}
}
