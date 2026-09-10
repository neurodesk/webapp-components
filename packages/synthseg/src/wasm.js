// Glue for ./synthseg.wasm (see ../wasm/src/lib.rs): a plain C ABI, no wasm-bindgen.
// Every typed-array view is re-taken after any export call, because growing the wasm
// heap for the posteriors detaches the previous ArrayBuffer.

/** @param source a Response, a Promise of one, an ArrayBuffer/TypedArray or a WebAssembly.Module */
export async function loadSynthseg(source) {
  const wasm = await instantiate(await source);
  const u8 = () => new Uint8Array(wasm.memory.buffer);
  const text = (ptr, len) => new TextDecoder().decode(u8().subarray(ptr, ptr + len));
  const check = () => new Error(text(wasm.seg_error_ptr(), wasm.seg_error_len()) || 'SynthSeg preprocessing failed.');
  const f32 = (ptr, len) => new Float32Array(wasm.memory.buffer, ptr, len).slice();

  class Segmenter {
    constructor(bytes, { ct = false } = {}) {
      const ptr = wasm.alloc(bytes.length);
      u8().set(bytes, ptr);
      this.seg = wasm.seg_new(ptr, bytes.length, ct ? 1 : 0);
      wasm.dealloc(ptr, bytes.length);
      if (!this.seg) throw check();
      this.padded = Array.from(new Uint32Array(wasm.memory.buffer, wasm.seg_padded(this.seg), 3));
      this.voxels = this.padded[0] * this.padded[1] * this.padded[2];
      this.geometry = JSON.parse(text(wasm.seg_geometry(this.seg), wasm.seg_geometry_len(this.seg)));
    }
    input() { return f32(wasm.seg_input(this.seg), this.voxels); }
    flippedInput() { return f32(wasm.seg_flipped_input(this.seg), this.voxels); }
    /** Copy channel-major posteriors in, blur them, and keep or flip-average them. */
    posteriors(values, { flipped = false } = {}) {
      const ptr = wasm.seg_scratch(this.seg);
      new Float32Array(wasm.memory.buffer, ptr, values.length).set(values);
      wasm.seg_accumulate(this.seg, flipped ? 1 : 0);
    }
    labels({ fast = false } = {}) {
      const ptr = wasm.seg_labels(this.seg, fast ? 1 : 0);
      return { buffer: u8().slice(ptr, ptr + wasm.seg_labels_len(this.seg)), geometry: this.geometry };
    }
    free() { if (this.seg) { wasm.seg_free(this.seg); this.seg = 0; } }
  }
  return { Segmenter };
}

async function instantiate(source) {
  if (source instanceof WebAssembly.Module) return (await WebAssembly.instantiate(source, {})).exports;
  // ponytail: buffer a Response instead of instantiateStreaming; the module is ~160 kB, and this
  // one code path is immune to servers that mislabel .wasm.
  const bytes = typeof Response !== 'undefined' && source instanceof Response ? await source.arrayBuffer() : source;
  return (await WebAssembly.instantiate(bytes, {})).instance.exports;
}
