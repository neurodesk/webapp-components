"""Numerical stage comparison; run after container-reference and JS/WASM runs."""
import argparse,json,pathlib,hashlib
import numpy as np
import nibabel as nib
from scipy.io import loadmat
p=argparse.ArgumentParser();p.add_argument('work');p.add_argument('--output',required=True);a=p.parse_args();w=pathlib.Path(a.work)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def compare(left,right,mask=False):
    x=nib.load(left);y=nib.load(right)
    assert x.shape==y.shape,(x.shape,y.shape)
    geometry=float(np.max(np.abs(x.affine-y.affine)));assert geometry<1e-4,geometry
    xv=x.get_fdata(dtype=np.float32);yv=y.get_fdata(dtype=np.float32);delta=np.abs(xv-yv)
    result={'shape':list(x.shape),'max_affine_difference_mm':geometry,'max_absolute_difference':float(delta.max()),'mean_absolute_difference':float(delta.mean(dtype=np.float64)),'different_voxels':int(np.count_nonzero(delta)),'voxel_count':int(delta.size)}
    if mask:result['dice']=float(2*np.count_nonzero((xv>0)&(yv>0))/(np.count_nonzero(xv>0)+np.count_nonzero(yv>0)))
    return result
r={'dataset':{'id':'ds000001','subject':'sub-01','file':'anat/sub-01_T1w.nii.gz','url':'https://s3.amazonaws.com/openneuro.org/ds000001/sub-01/anat/sub-01_T1w.nii.gz','sha256':sha(w/'sub-01_T1w.nii.gz')},'container':'vnmd/syncro_0.1.1@sha256:51246ec424976d130bd4ed731b7e1f0d3401c22146c200664eb77fc77159e946','reference':json.loads((w/'reference/reference.json').read_text()),'comparisons':{}}
c=r['comparisons'];c['synthsr']=compare(w/'reference/synthsr.nii.gz',w/'web-synthsr.nii.gz');assert c['synthsr']['max_absolute_difference']<=1
x=np.fromfile(w/'container-conformed.f32',dtype=np.float32);y=np.fromfile(w/'web-strip/conformed.f32',dtype=np.float32)
c['synthstrip_preprocessing']={'identical':bool(np.array_equal(x,y))};assert c['synthstrip_preprocessing']['identical']
for key,file in [('mask','mask'),('brain','brain'),('distance','sdt')]:c['synthstrip_'+key]=compare(w/f'isolation-{file}.nii.gz',w/f'web-strip/{key}.nii',mask=key=='mask')
assert c['synthstrip_mask']['dice']==1;assert c['synthstrip_brain']['max_absolute_difference']==0;assert c['synthstrip_distance']['max_absolute_difference']<1e-3
for key,left,right in [('registration_brain','warped-brain.nii.gz','warped-brain.nii.gz'),('resampling_original','warped-original.nii.gz','warped-original.nii.gz'),('forward_field','transform-1Warp.nii.gz','1Warp.nii.gz'),('inverse_field','transform-1InverseWarp.nii.gz','1InverseWarp.nii.gz')]:c[key]=compare(w/'reference'/left,w/'wasm-registration'/right)
for key in ['registration_brain','resampling_original','forward_field','inverse_field']:assert c[key]['max_absolute_difference']==0,(key,c[key])
left=loadmat(w/'reference/transform-0GenericAffine.mat');right=loadmat(w/'wasm-registration/0GenericAffine.mat')
c['affine']={k:float(np.max(np.abs(left[k]-right[k]))) for k in left if not k.startswith('_')}
assert all(v==0 for v in c['affine'].values()),c['affine']
r['wasm_runtime']=json.loads((w/'wasm-registration/report.json').read_text())
r['scope']='One real T1 scan. SynthStrip and registration isolated on identical inputs. Not clinical validation or evidence for all modalities/pathologies.'
pathlib.Path(a.output).write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps(c,indent=2))
