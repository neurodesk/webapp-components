#!/usr/bin/env python3
"""Generate independent Python output and sampled voxels for browser validation."""
import os
os.environ.setdefault('TF_NUM_INTRAOP_THREADS', '2')
os.environ.setdefault('TF_NUM_INTEROP_THREADS', '1')
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import nibabel as nib
import numpy as np

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, required=True)
p.add_argument('--input', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
backend = p.add_mutually_exclusive_group(required=True)
backend.add_argument('--checkpoint', type=Path)
backend.add_argument('--onnx', type=Path)
p.add_argument('--no-flip', action='store_true')
a = p.parse_args()
if hashlib.sha256(a.source.read_bytes()).hexdigest() != 'f90e7e5589acb6f9c97861a399d4c6c8c5fedf0a9fc304883290eec20603c79b':
    raise ValueError('Use the pinned Python reference source')
spec = importlib.util.spec_from_file_location('reference', a.source)
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)
x, affine, header, pad = ref.preprocess(str(a.input), False)
print(f'Prepared {x.shape}', flush=True)
if a.checkpoint:
    model = ref.build_model(str(a.checkpoint))
    def infer(data):
        return model(data, training=False).numpy()[0, ..., 0]
else:
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(a.onnx), options, providers=['CPUExecutionProvider'])
    def infer(data):
        return session.run(None, {session.get_inputs()[0].name: data.transpose(0, 4, 1, 2, 3).astype(np.float32)})[0][0, 0]
y = np.clip(255 * infer(x), 0, 128)
if not a.no_flip:
    y = .5 * (y + np.flip(np.clip(255 * infer(np.flip(x, axis=1).copy()), 0, 128), axis=0))
result = ref.postprocess(y, pad, affine, False)
a.output.parent.mkdir(parents=True, exist_ok=True)
ref.save_volume_byte(result, affine, header, str(a.output))
image = nib.load(a.output)
data = image.get_fdata().astype(np.uint8).flatten(order='F')
indices = np.random.default_rng(123).integers(0, len(data), size=10000)
report = {
    'reference': 'TensorFlow' if a.checkpoint else 'ONNX Runtime CPU',
    'input_sha256': hashlib.sha256(a.input.read_bytes()).hexdigest(),
    'model_sha256': hashlib.sha256((a.checkpoint or a.onnx).read_bytes()).hexdigest(),
    'flip': not a.no_flip, 'sharpen': True, 'dims': list(image.shape),
    'indices': indices.tolist(), 'values': data[indices].tolist(),
}
a.output.with_suffix('.samples.json').write_text(json.dumps(report) + '\n')
print(f'Saved {a.output}', flush=True)
