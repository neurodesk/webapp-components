#!/usr/bin/env python3
"""Index the pinned ONNX graph/weight bytes for the specialized WebGPU executor.

No weights are duplicated or converted. Runtime verifies the entire ONNX SHA-256
before using these offsets. Regenerate whenever the validated model changes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import onnx

ROOT = Path(__file__).resolve().parents[3]

def index_model(path):
    raw = path.read_bytes()
    manifest = json.loads((ROOT / 'models/synthsr.manifest.json').read_text())
    asset = next(a for a in manifest['assets'] if a['filename'] == 'synthsr-v2.onnx')
    digest = hashlib.sha256(raw).hexdigest()
    if digest != asset['sha256']:
        raise ValueError('Expected the manifest-pinned SynthSR ONNX file')
    model = onnx.load_model_from_string(raw)
    tensors = {}
    for t in model.graph.initializer:
        if t.data_type != onnx.TensorProto.FLOAT or not t.raw_data:
            raise ValueError(f'Expected embedded float32 initializer: {t.name}')
        # Equal byte sequences may share an offset; they are equal tensors' data.
        offset = raw.find(t.raw_data)
        if offset < 0:
            raise ValueError(f'Initializer bytes not found: {t.name}')
        tensors[t.name] = {'dims': list(t.dims), 'offset': offset, 'bytes': len(t.raw_data)}
    nodes = []
    for n in model.graph.node:
        attrs = {}
        for a in n.attribute:
            value = onnx.helper.get_attribute_value(a)
            attrs[a.name] = value.decode() if isinstance(value, bytes) else value
        nodes.append({'name': n.name or n.output[0], 'op': n.op_type,
                      'inputs': list(n.input), 'output': n.output[0], 'attrs': attrs})
    return {'sha256': digest, 'bytes': len(raw), 'input': model.graph.input[0].name,
            'output': model.graph.output[0].name, 'tensors': tensors, 'nodes': nodes}

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('model', type=Path)
    p.add_argument('--output', type=Path, default=ROOT / 'packages/synthsr/src/gpu-model.json')
    args = p.parse_args()
    args.output.write_text(json.dumps(index_model(args.model), indent=2) + '\n')
