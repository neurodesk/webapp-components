import { test } from 'node:test';
import assert from 'node:assert/strict';
import synthseg from '../../synthseg/src/gpu-model.json' with { type: 'json' };
import synthsr from '../../synthsr/src/gpu-model.json' with { type: 'json' };
import { planGpuGraph } from '../src/gpu-unet/index.js';
import { elementShader } from '../src/gpu-unet/session.js';
import { conv3dShader } from '../src/gpu-unet/conv3d.js';

const CLASSES = 33;

for (const dims of [[128,128,128],[192,224,160]]) {
  test(`SynthSeg plan reuses buffers without clobbering a live tensor: ${dims}`,()=>{
    const plan=planGpuGraph(dims,synthseg,{outputChannels:CLASSES,label:'SynthSeg'});
    const live=new Map([[synthseg.input,0]]),remaining=new Map();
    for(const node of plan.nodes)for(const input of node.inputs)if(!synthseg.tensors[input] && input)remaining.set(input,(remaining.get(input)||0)+1);
    for(const node of plan.nodes) {
      assert.ok(![...live.values()].includes(node.slot),`${node.name} overwrites a live tensor`);
      for(let i=0;i<node.inputs.length;i++)if(live.has(node.inputs[i]))assert.equal(node.inputSlots[i],live.get(node.inputs[i]));
      assert.ok(plan.slots[node.slot].bytes>=node.shape.dims.reduce((a,b)=>a*b,4*node.shape.channels));
      live.set(node.output,node.slot);
      for(const input of node.inputs)if(remaining.has(input)) {
        remaining.set(input,remaining.get(input)-1);if(!remaining.get(input))live.delete(input);
      }
    }
    assert.deepEqual(plan.outputShape,{dims,channels:CLASSES});
    assert.equal(plan.nodes.filter(n=>n.op==='Concat').length,4);
    assert.equal(plan.nodes.filter(n=>n.op==='Softmax').length,1);
    for(const node of plan.nodes.filter(n=>n.op==='Conv'))assert.equal(node.shape.channels%4,0,`${node.name} is not padded to a multiple of four`);
    assert.equal(plan.nodes.find(n=>n.name==='unet_likelihood').shape.channels,36);
    assert.equal(live.size,1);
    assert.equal([...live.values()][0],plan.outputSlot);
  });
}

test('SynthSR still plans to a single output channel with the same node counts',()=>{
  const plan=planGpuGraph([32,32,32],synthsr,{label:'SynthSR'});
  assert.deepEqual(plan.outputShape,{dims:[32,32,32],channels:1});
  assert.equal(plan.nodes.filter(n=>n.op==='Conv').length,23);
  assert.equal(plan.nodes.filter(n=>n.elu).length,18);
  assert.equal(plan.nodes.filter(n=>n.op==='BatchNormalization').length,9);
});

test('the padded classifier head compiles as a blocked convolution',()=>{
  const code=conv3dShader({dims:[32,32,32],inputChannels:24,outputChannels:36,kernel:1});
  assert.match(code,/@workgroup_size/);
});

// Channel-major posteriors make the readback NCDHW, so no host transpose is needed.
test('Softmax stores posteriors channel-major',()=>{
  const dims=[32,32,32],voxels=32**3;
  const plan=planGpuGraph(dims,synthseg,{outputChannels:CLASSES,label:'SynthSeg'});
  const softmax=plan.nodes.find(n=>n.op==='Softmax');
  assert.equal(softmax.inputShape.channels,36);
  assert.ok(plan.slots[softmax.slot].bytes>=voxels*CLASSES*4);
  const {code}=elementShader(softmax);
  assert.match(code,new RegExp(`result\\[k\\*${voxels}u\\+i\\]=e;`));
  assert.doesNotMatch(code,/result\[i\*/);
});
