#!/usr/bin/env python3
"""Dump SynthSeg preprocessing and raw U-Net posteriors with FreeSurfer's own Keras code.

  fspython keras_reference.py INPUT.nii.gz OUTDIR [crop]

Writes OUTDIR/<stem>_input.npy (preprocessed NDHWC batch), <stem>_unet.npy (softmax
posteriors), <stem>_meta.json (aff, shape, pad_idx). Used to check the ONNX export.
"""
import json, os, sys
from importlib.machinery import SourceFileLoader
import numpy as np
fs = os.environ.get("FREESURFER_HOME", "/Applications/freesurfer/8.1.0")
ss = SourceFileLoader("synthseg", os.path.join(fs, "python", "scripts", "mri_synthseg")).load_module()
inp, out = sys.argv[1], sys.argv[2]
crop = [int(sys.argv[3])] * 3 if len(sys.argv) > 3 else None
stem = os.path.basename(inp).replace(".nii.gz", "").replace(".nii", "")
im, aff, h, im_res, shape, pad_idx, crop_idx = ss.preprocess(inp, ct=False, crop=crop, min_pad=128)
net = ss.unet(nb_features=24, input_shape=[None, None, None, 1], nb_levels=5, conv_size=3, nb_labels=33,
              feat_mult=2, activation='elu', nb_conv_per_level=2, batch_norm=-1, name='unet')
net.load_weights(os.path.join(fs, "models", "synthseg_2.0.h5"), by_name=True)
post = net.predict(im)
os.makedirs(out, exist_ok=True)
np.save(os.path.join(out, stem + "_input.npy"), im.astype(np.float32))
np.save(os.path.join(out, stem + "_unet.npy"), post.astype(np.float32))
json.dump({"aff": aff.tolist(), "shape": shape, "pad_idx": [int(i) for i in pad_idx],
           "crop_idx": None if crop_idx is None else [int(i) for i in crop_idx], "im_res": im_res.tolist()},
          open(os.path.join(out, stem + "_meta.json"), "w"))
print(im.shape, post.shape)
