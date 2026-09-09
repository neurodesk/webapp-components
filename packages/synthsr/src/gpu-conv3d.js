// FP32 implicit matrix multiplication: a workgroup stages a reduction chunk of
// activations and weights in workgroup memory, and every thread accumulates a
// register block of spatial positions by output channels. Each staged value then
// feeds several FMAs instead of one, which is what limits this kernel.
// Activations are NDHWC; weights are [kernel spatial, input channel, output channel].
// Unlike image tiling, this changes only the execution schedule, not context.
const POSITIONS = 2;   // spatial positions accumulated per thread
const CHUNK = 16;      // reduction elements staged per barrier
const ROWS = 64;       // thread rows per workgroup; POSITIONS*ROWS positions per tile
const INVOCATIONS = 256; // WebGPU's baseline maxComputeInvocationsPerWorkgroup
const STORAGE = 16384;   // WebGPU's baseline maxComputeWorkgroupStorageSize

// Largest channel tile that divides the layer's channels, so no lane computes a
// discarded channel. The pinned graph's convolutions are all multiples of eight.
// Tiles that would exceed WebGPU's baseline workgroup limits are rejected rather
// than emitted, so an unsupported channel count cannot reach pipeline creation.
function channelBlock(outputChannels) {
  for (const channels of [8, 4]) {
    for (let tile = Math.min(32, outputChannels); tile >= channels; tile -= channels) {
      if (outputChannels % tile || tile % channels) continue;
      if ((tile / channels) * ROWS > INVOCATIONS) continue;
      if (4 * CHUNK * (POSITIONS * ROWS + tile) > STORAGE) continue;
      return { channels, tile };
    }
  }
  throw new Error('Blocked Conv3D requires output channels divisible by four.');
}

export function conv3dShader({ dims, inputChannels, outputChannels, kernel = 3, bias = true, elu = false }) {
  const [d,h,w] = dims, spatial = d*h*w, reduction = kernel**3*inputChannels;
  const {channels, tile} = channelBlock(outputChannels);
  const columns = tile/channels, positions = POSITIONS*ROWS, lanes = channels/4, outputVectors = outputChannels/4;
  const groupsX = Math.min(65535, Math.ceil(spatial/positions));
  const accumulators = [], products = [], stores = [];
  for (let p=0;p<POSITIONS;p++) for (let j=0;j<lanes;j++) accumulators.push(`var sum${p}_${j} = vec4<f32>(0.0);`);
  for (let j=0;j<lanes;j++) products.push(`let weight${j} = b[k * ${tile/4}u + local.x * ${lanes}u + ${j}u];`);
  for (let p=0;p<POSITIONS;p++) {
    products.push(`let activation${p} = a[k * ${positions}u + local.y + ${p*ROWS}u];`);
    for (let j=0;j<lanes;j++) products.push(`sum${p}_${j} += activation${p} * weight${j};`);
  }
  for (let p=0;p<POSITIONS;p++) {
    const writes = [];
    for (let j=0;j<lanes;j++) writes.push(`{ var value = sum${p}_${j}${bias?` + biases[channel / 4u + ${j}u]`:''};
      ${elu?'value = select(exp(value) - vec4<f32>(1.0), value, value >= vec4<f32>(0.0));':''}
      result[position${p} * ${outputVectors}u + channel / 4u + ${j}u] = value; }`);
    stores.push(`let position${p} = base + local.y + ${p*ROWS}u;
  if (position${p} < ${spatial}u) { ${writes.join('\n    ')} }`);
  }
  return `
@group(0) @binding(0) var<storage,read> input: array<f32>;
@group(0) @binding(1) var<storage,read> weights: array<vec4<f32>>;
@group(0) @binding(2) var<storage,read> biases: array<vec4<f32>>;
@group(0) @binding(3) var<storage,read_write> result: array<vec4<f32>>;
var<workgroup> a: array<f32,${CHUNK*positions}>;
var<workgroup> b: array<vec4<f32>,${CHUNK*tile/4}>;
fn gather(position: u32, k: u32) -> f32 {
  if (position >= ${spatial}u || k >= ${reduction}u) { return 0.0; }
  let tap = k / ${inputChannels}u;
  let z = i32(position % ${w}u) + i32(tap % ${kernel}u) - ${Math.floor(kernel/2)};
  let y = i32(position / ${w}u % ${h}u) + i32(tap / ${kernel}u % ${kernel}u) - ${Math.floor(kernel/2)};
  let x = i32(position / ${w*h}u) + i32(tap / ${kernel*kernel}u) - ${Math.floor(kernel/2)};
  if (x < 0 || y < 0 || z < 0 || x >= ${d} || y >= ${h} || z >= ${w}) { return 0.0; }
  return input[((u32(x)*${h}u+u32(y))*${w}u+u32(z))*${inputChannels}u+k%${inputChannels}u];
}
@compute @workgroup_size(${columns},${ROWS},1)
fn main(@builtin(workgroup_id) group: vec3<u32>, @builtin(local_invocation_id) local: vec3<u32>) {
  let base = (group.x + group.y*${groupsX}u)*${positions}u;
  let channel = group.z*${tile}u + local.x*${channels}u;
  let tid = local.y*${columns}u+local.x;
  ${accumulators.join('\n  ')}
  for (var start=0u; start<${reduction}u; start+=${CHUNK}u) {
    // Activations are staged as [reduction][position] so neighbouring lanes read
    // neighbouring words, and each thread's positions stay coalesced on store.
    for (var i=tid; i<${CHUNK*positions}u; i+=${columns*ROWS}u) { a[i]=gather(base+i%${positions}u,start+i/${positions}u); }
    for (var i=tid; i<${CHUNK*tile/4}u; i+=${columns*ROWS}u) {
      let k=start+i/${tile/4}u;
      let c=group.z*${tile}u+(i%${tile/4}u)*4u;
      var value=vec4<f32>(0.0);
      if (k<${reduction}u) { value=weights[k*${outputVectors}u+c/4u]; }
      b[i]=value;
    }
    workgroupBarrier();
    for (var k=0u;k<${CHUNK}u;k++) {
      ${products.join('\n      ')}
    }
    workgroupBarrier();
  }
  ${stores.join('\n  ')}
}`;
}

// Tile geometry, so callers and tests can check dispatch coverage and that the
// tunables above stay inside WebGPU's baseline workgroup limits.
export function conv3dTile(outputChannels) {
  const {channels,tile}=channelBlock(outputChannels), positions=POSITIONS*ROWS;
  return {positions,channels:tile,threads:(tile/channels)*ROWS,sharedBytes:4*CHUNK*positions+4*CHUNK*tile};
}

export function conv3dDispatch(dims, outputChannels) {
  const groups = Math.ceil(dims.reduce((a,b)=>a*b,1)/(POSITIONS*ROWS));
  const x = Math.min(65535, groups);
  return [x, Math.ceil(groups/x), outputChannels/channelBlock(outputChannels).tile];
}

export function packConvWeights(values, [outputChannels,inputChannels,...kernel]) {
  const taps=kernel.reduce((a,b)=>a*b,1), packed=new Float32Array(values.length);
  for(let o=0;o<outputChannels;o++) for(let i=0;i<inputChannels;i++) for(let k=0;k<taps;k++) {
    packed[(k*inputChannels+i)*outputChannels+o]=values[(o*inputChannels+i)*taps+k];
  }
  return packed;
}
