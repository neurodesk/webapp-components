#!/usr/bin/env python3
"""synthseg_2.0.h5 (Keras) -> models/synthseg-2.0.onnx + packages/synthseg/src/gpu-model.json.

Rebuilds the neuron unet(nb_features=24, nb_levels=5, conv_size=3, feat_mult=2,
nb_conv_per_level=2, activation='elu', batch_norm=-1) topology directly from the
checkpoint, so no TensorFlow is needed. Graph is NCDHW ONNX (opset 17), output
is the softmax posterior [1, 33, D, H, W]. gpu-model.json is the executor
schema used by the Metal port: NDHWC nodes plus byte ranges into the .onnx file.
"""
import hashlib, json, sys, os
import numpy as np, h5py, onnx
from onnx import helper, TensorProto, numpy_helper

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
h5_path = sys.argv[1] if len(sys.argv) > 1 else "/Applications/freesurfer/8.1.0/models/synthseg_2.0.h5"
onnx_path = os.path.join(root, "models", "synthseg-2.0.onnx")
graph_path = os.path.join(root, "..", "..", "packages", "synthseg", "src", "gpu-model.json")
LEVELS, EPS = 5, 1e-3

h = h5py.File(h5_path, "r")
weight = lambda layer, name: np.asarray(h[layer][layer][name + ":0"], dtype=np.float32)
used = set()
inits, nodes, tensors = [], [], {}

def add_tensor(name, arr):
    inits.append(numpy_helper.from_array(np.ascontiguousarray(arr), name))
    tensors[name] = {"dims": list(arr.shape), "bytes": arr.nbytes}

def conv(x, layer, elu):
    used.add(layer)
    k = weight(layer, "kernel").transpose(4, 3, 0, 1, 2)  # Keras [k,k,k,ci,co] -> ONNX [co,ci,k,k,k]
    add_tensor(layer + "_W", k); add_tensor(layer + "_B", weight(layer, "bias"))
    ks = k.shape[2]
    out = layer + ("_conv" if elu else "")
    nodes.append(helper.make_node("Conv", [x, layer + "_W", layer + "_B"], [out], name=out,
                                  kernel_shape=[ks] * 3, pads=[ks // 2] * 6, strides=[1, 1, 1]))
    if elu:
        nodes.append(helper.make_node("Elu", [out], [layer], name=layer, alpha=1.0))
        return layer
    return out

def bn(x, layer):
    used.add(layer)
    for p in ("gamma", "beta", "moving_mean", "moving_variance"):
        add_tensor(f"{layer}_{p}", weight(layer, p))
    nodes.append(helper.make_node("BatchNormalization",
        [x] + [f"{layer}_{p}" for p in ("gamma", "beta", "moving_mean", "moving_variance")],
        [layer], name=layer, epsilon=EPS))
    return layer

x, skips = "input", []
for level in range(LEVELS):
    x = conv(x, f"unet_conv_downarm_{level}_0", True)
    x = conv(x, f"unet_conv_downarm_{level}_1", True)
    skips.append(x)  # skip is the conv output, before batch norm
    x = bn(x, f"unet_bn_down_{level}")
    if level < LEVELS - 1:
        name = f"unet_maxpool_{level}"
        nodes.append(helper.make_node("MaxPool", [x], [name], name=name, kernel_shape=[2] * 3,
                                      strides=[2] * 3, auto_pad="SAME_UPPER"))
        x = name
add_tensor("scales", np.array([1, 1, 2, 2, 2], dtype=np.float32))
for level in range(LEVELS - 1):
    name = f"unet_up_{LEVELS + level}"
    nodes.append(helper.make_node("Resize", [x, "", "scales"], [name], name=name, mode="nearest",
                                  coordinate_transformation_mode="asymmetric", nearest_mode="floor"))
    name2 = f"unet_merge_{LEVELS + level}"
    nodes.append(helper.make_node("Concat", [skips[LEVELS - 2 - level], name], [name2], name=name2, axis=1))
    x = conv(name2, f"unet_conv_uparm_{LEVELS + level}_0", True)
    x = conv(x, f"unet_conv_uparm_{LEVELS + level}_1", True)
    x = bn(x, f"unet_bn_up_{level}")
x = conv(x, "unet_likelihood", False)
nodes.append(helper.make_node("Softmax", [x], ["output"], name="unet_prediction", axis=1))

unused = sorted(k for k in h.keys() if k not in used and len(h[k]) > 0)
assert not unused, f"unused checkpoint layers: {unused}"
dims = ["N", "C", "D", "H", "W"]
graph = helper.make_graph(nodes, "synthseg_2_0",
    [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 1, "D", "H", "W"])],
    [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 33, "D", "H", "W"])], inits)
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="synthseg-export")
model.ir_version = 8
onnx.checker.check_model(model)
blob = model.SerializeToString()
with open(onnx_path, "wb") as f:
    f.write(blob)

# Byte offsets of each initializer's raw_data inside the serialized file, scanned in order.
pos = 0
for t in inits:
    raw = t.raw_data
    pos = blob.find(raw, pos)
    assert pos >= 0, t.name
    tensors[t.name]["offset"] = pos
    pos += len(raw)
def attrs(n):
    return {a.name: helper.get_attribute_value(a) if a.type != onnx.AttributeProto.STRING
            else helper.get_attribute_value(a).decode() for a in n.attribute}
json.dump({
    "sha256": hashlib.sha256(blob).hexdigest(), "bytes": len(blob), "input": "input", "output": "output",
    "nodes": [{"name": n.name, "op": n.op_type, "inputs": [i for i in n.input if i], "output": n.output[0],
               "attrs": attrs(n)} for n in nodes],
    "tensors": tensors,
}, open(graph_path, "w"), indent=0)
print(onnx_path, len(blob), hashlib.sha256(blob).hexdigest())
