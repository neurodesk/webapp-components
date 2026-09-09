import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import model from '../../../packages/synthsr/src/gpu-model.json' with { type: 'json' };
import { planGpuGraph, createGpuSession } from '@neurodesk/synthsr/browser';
import { conv3dDispatch, conv3dTile, packConvWeights } from '../../../packages/synthsr/src/gpu-conv3d.js';

test('GPU graph is pinned to the same model as the browser',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../../models/synthsr.manifest.json',import.meta.url)));
  const asset=manifest.assets.find(a=>a.filename==='synthsr-v2.onnx');
  assert.equal(model.sha256,asset.sha256);assert.equal(model.bytes,asset.bytes);
  for(const t of Object.values(model.tensors)) {
    assert.equal(t.bytes,t.dims.reduce((a,b)=>a*b,4));
    assert.ok(t.offset>=0 && t.offset+t.bytes<=model.bytes);
  }
  await assert.rejects(createGpuSession(new Uint8Array(16),[32,32,32]),/validated SynthSR model/);
});

for(const dims of [[32,32,32],[32,64,96],[192,256,160]]) {
  test(`GPU buffer reuse preserves every live tensor and skip: ${dims}`,()=>{
    const plan=planGpuGraph(dims),live=new Map([['input',0]]),remaining=new Map();
    for(const node of plan.nodes)for(const input of node.inputs)if(!model.tensors[input] && input)remaining.set(input,(remaining.get(input)||0)+1);
    for(const node of plan.nodes) {
      assert.ok(![...live.values()].includes(node.slot),`${node.name} overwrites a live tensor`);
      for(let i=0;i<node.inputs.length;i++)if(live.has(node.inputs[i]))assert.equal(node.inputSlots[i],live.get(node.inputs[i]));
      assert.ok(plan.slots[node.slot].bytes>=node.shape.dims.reduce((a,b)=>a*b,4*node.shape.channels));
      live.set(node.output,node.slot);
      for(const input of node.inputs)if(remaining.has(input)) {
        remaining.set(input,remaining.get(input)-1);if(!remaining.get(input))live.delete(input);
      }
    }
    assert.deepEqual(plan.outputShape,{dims,channels:1});
    assert.equal(plan.nodes.filter(n=>n.op==='Conv').length,23);
    assert.equal(plan.nodes.filter(n=>n.elu).length,18);
    assert.equal(plan.nodes.filter(n=>n.op==='BatchNormalization').length,9);
    assert.equal(live.size,1);
    assert.equal([...live.values()][0],plan.outputSlot);
  });
}

test('GPU dimensions reject incompatible pooling shapes',()=>{
  for(const dims of [[31,32,32],[0,32,32],[32,32],[32,NaN,32],[32,33,32]])assert.throws(()=>planGpuGraph(dims),/multiples of 32/);
});

test('GPU graph rejects unsupported changes instead of silently changing semantics',()=>{
  for(const [op,attribute,value] of [['Conv','group',2],['Conv','dilations',[2,2,2]],['MaxPool','ceil_mode',1],['Elu','alpha',2],['BatchNormalization','training_mode',1]]) {
    const changed=structuredClone(model);
    changed.nodes.find(n=>n.op===op).attrs[attribute]=value;
    assert.throws(()=>planGpuGraph([32,32,32],changed),/Unsupported/);
  }
});

test('full-volume dispatch covers output without exceeding WebGPU per-axis limits',()=>{
  const dims=[192,256,160],co=24,[x,y,z]=conv3dDispatch(dims,co),tile=conv3dTile(co);
  assert.ok(x<=65535 && y<=65535 && z<=65535);
  assert.ok(x*y*tile.positions>=dims.reduce((a,b)=>a*b,1));
  assert.ok(z*tile.channels>=co && co%tile.channels===0);
});

test('convolution tiles stay inside baseline WebGPU workgroup limits',()=>{
  for(const node of planGpuGraph([192,256,160]).nodes.filter(n=>n.op==='Conv'&&n.shape.channels>1)) {
    const tile=conv3dTile(node.shape.channels);
    assert.ok(tile.threads<=256,`${node.name} uses ${tile.threads} invocations`);
    assert.ok(tile.sharedBytes<=16384,`${node.name} uses ${tile.sharedBytes} bytes of workgroup storage`);
  }
});

test('weight packing preserves ONNX output/input/spatial ordering',()=>{
  const dims=[8,3,3,3,3],src=Float32Array.from({length:dims.reduce((a,b)=>a*b,1)},(_,i)=>i);
  const actual=packConvWeights(src,dims);
  for(let output=0;output<8;output++)for(let input=0;input<3;input++)for(let tap=0;tap<27;tap++) {
    assert.equal(actual[(tap*3+input)*8+output],src[(output*3+input)*27+tap]);
  }
});
