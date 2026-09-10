#!/usr/bin/env python3
"""Compare ONNX Runtime output with the Keras dump from keras_reference.py."""
import sys, numpy as np, onnxruntime as ort
stem = sys.argv[1]
x = np.load(stem + "_input.npy").transpose(0, 4, 1, 2, 3)  # NDHWC -> NCDHW
ref = np.load(stem + "_unet.npy")
s = ort.InferenceSession(sys.argv[2] if len(sys.argv) > 2 else "models/synthseg-2.0.onnx")
y = s.run(None, {"input": x})[0].transpose(0, 2, 3, 4, 1)
print("max abs diff", np.abs(y - ref).max(), "argmax mismatches", int((y.argmax(-1) != ref.argmax(-1)).sum()), "of", ref[..., 0].size)
