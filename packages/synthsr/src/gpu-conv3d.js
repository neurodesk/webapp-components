// FP32 implicit matrix multiplication: a workgroup computes 16 spatial positions
// by 32 output channels, reusing a 32-element reduction tile in workgroup memory.
// Activations are NDHWC; weights are [kernel spatial, input channel, output channel].
// Unlike image tiling, this changes only the execution schedule, not context.
export function conv3dShader({ dims, inputChannels, outputChannels, kernel = 3, bias = true, elu = false }) {
  const [d,h,w] = dims, spatial = d*h*w, reduction = kernel**3*inputChannels;
  const groupsX = Math.min(65535, Math.ceil(spatial/16));
  const store = (p, v) => `if (${p} < ${spatial}u && channel < ${outputChannels}u) {
    var value = ${v};
    ${bias ? 'value += biases[channel/4u];' : ''}
    ${elu ? 'value = select(exp(value)-vec4<f32>(1.0), value, value >= vec4<f32>(0.0));' : ''}
    result[${p} * ${outputChannels/4}u + channel/4u] = value;
  }`;
  if (outputChannels % 4) throw new Error('Blocked Conv3D requires output channels divisible by four.');
  return `
@group(0) @binding(0) var<storage,read> input: array<f32>;
@group(0) @binding(1) var<storage,read> weights: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> biases: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> result: array<vec4<f32>>;
var<workgroup> a: array<f32,512>;
var<workgroup> b: array<vec4<f32>,256>;
fn gather(position: u32, k: u32) -> f32 {
  if (position >= ${spatial}u || k >= ${reduction}u) { return 0.0; }
  let tap = k / ${inputChannels}u;
  let z = i32(position % ${w}u) + i32(tap % ${kernel}u) - ${Math.floor(kernel/2)};
  let y = i32(position / ${w}u % ${h}u) + i32(tap / ${kernel}u % ${kernel}u) - ${Math.floor(kernel/2)};
  let x = i32(position / ${w*h}u) + i32(tap / ${kernel*kernel}u) - ${Math.floor(kernel/2)};
  if (x < 0 || y < 0 || z < 0 || x >= ${d} || y >= ${h} || z >= ${w}) { return 0.0; }
  return input[((u32(x)*${h}u+u32(y))*${w}u+u32(z))*${inputChannels}u+k%${inputChannels}u];
}
@compute @workgroup_size(8,8,1)
fn main(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>) {
  let base = (group.x + group.y*${groupsX}u)*16u;
  let channel = group.z*32u + local.x*4u;
  let tid = local.y*8u+local.x;
  var sum0 = vec4<f32>(0.0);
  var sum1 = vec4<f32>(0.0);
  for (var start=0u; start<${reduction}u; start+=32u) {
    for (var i=tid; i<512u; i+=64u) { a[i] = gather(base+i/32u,start+i%32u); }
    for (var i=tid; i<256u; i+=64u) {
      let k = start+i/8u;
      let c = group.z*32u+(i%8u)*4u;
      var value = vec4<f32>(0.0);
      if (k<${reduction}u && c<${outputChannels}u) { value=weights[k*${outputChannels/4}u+c/4u]; }
      b[i]=value;
    }
    workgroupBarrier();
    for (var k=0u;k<32u;k++) {
      let weight=b[k*8u+local.x];
      sum0 += a[(local.y*2u)*32u+k]*weight;
      sum1 += a[(local.y*2u+1u)*32u+k]*weight;
    }
    workgroupBarrier();
  }
  let p0=base+local.y*2u;
  let p1=p0+1u;
  ${store('p0','sum0')}
  ${store('p1','sum1')}
}`;
}

export function conv3dDispatch(dims, outputChannels) {
  const groups = Math.ceil(dims.reduce((a,b)=>a*b,1)/16);
  const x = Math.min(65535, groups);
  return [x, Math.ceil(groups/x), Math.ceil(outputChannels/32)];
}

export function packConvWeights(values, [outputChannels,inputChannels,...kernel]) {
  const taps=kernel.reduce((a,b)=>a*b,1), packed=new Float32Array(values.length);
  for(let o=0;o<outputChannels;o++) for(let i=0;i<inputChannels;i++) for(let k=0;k<taps;k++) {
    packed[(k*inputChannels+i)*outputChannels+o]=values[(o*inputChannels+i)*taps+k];
  }
  return packed;
}
