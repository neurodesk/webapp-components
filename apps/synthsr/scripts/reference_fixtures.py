#!/usr/bin/env python3
"""Generate synthetic, non-patient fixtures using the pinned upstream code."""
import argparse, importlib.util, json
from pathlib import Path
import numpy as np
import nibabel as nib
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--assets',type=Path,required=True)
a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('ref',a.source);ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
x,y,z=np.indices((17,19,21));data=(20+3*x+7*y+11*z+20*np.sin(x/3)).astype(np.float32)
cases=[('anisotropic',[[1.2,0,0,13],[0,0.75,0,-7],[0,0,1.5,3],[0,0,0,1]],False),('permuted',[[0,0,-1.25,30],[-0.75,0,0,-10],[0,1.5,0,5],[0,0,0,1]],False),('ct',[[0.8,0.15,0,2],[0,1.4,0.2,-4],[0,0,1.1,7],[0,0,0,1]],True)]
records=[]
for name,aff,ct in cases:
    image=nib.Nifti1Image(data-200 if ct else data,np.array(aff));path=a.out/(name+'.nii.gz');nib.save(image,path)
    inp,aff1,h,pad=ref.preprocess(str(path),ct)
    inp.astype('<f4').tofile(a.out/(name+'-input.bin'))
    pred=inp[0,...,0]*128
    final=ref.postprocess(pred,pad,aff1,False)
    ref.save_volume_byte(final,aff1,h,str(a.out/(name+'-output.nii.gz')))
    records.append({'name':name,'ct':ct,'paddedDims':list(inp.shape[1:4]),'affine':aff1.tolist()})
(a.out/'spatial.json').write_text(json.dumps(records,indent=2)+'\n')
# A small end-to-end network fixture exercises real weights in browser CI.
x,y,z=np.indices((32,32,32));data=(100*np.exp(-((x-16)**2/60+(y-16)**2/90+(z-16)**2/80))+10*np.sin(x/5)**2).astype(np.float32)
a.assets.mkdir(parents=True,exist_ok=True)
image=nib.Nifti1Image(data,np.eye(4))
nib.save(image,a.assets/'validation.nii.gz')
nib.save(image,a.out/'validation.nii.gz')
