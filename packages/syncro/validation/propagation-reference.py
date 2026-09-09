"""Synthetic binary/label fixtures on the real scan's grid; no patient lesion claim."""
import os
os.environ['ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS']='1'
import sys,pathlib,numpy as np,nibabel as nib,ants
sys.path.insert(0,'/opt');import SYNcro
w=pathlib.Path('/work');source=nib.load(w/'sub-01_T1w.nii.gz');d=source.shape
x,y,z=np.ogrid[:d[0],:d[1],:d[2]]
binary=(((x-80)/12)**2+((y-95)/8)**2+((z-96)/9)**2<1).astype(np.uint8)
labels=binary*3;labels[70:75,80:85,80:85]=7
for name,data in [('binary',binary),('labels',labels)]:nib.save(nib.Nifti1Image(data,source.affine),w/(name+'.nii.gz'))
fixed=ants.image_read(str(w/'reference/template.nii.gz'));transforms=[str(w/'reference/transform-1Warp.nii.gz'),str(w/'reference/transform-0GenericAffine.mat')]
SYNcro.dilate_smooth_nifti(str(w/'binary.nii.gz'),str(w/'binary-smoothed.nii.gz'))
for name,inp,interp in [('binary','binary-smoothed','linear'),('labels','labels','nearestNeighbor')]:
 output=w/('reference-'+name+'.nii.gz')
 ants.apply_transforms(fixed,ants.image_read(str(w/(inp+'.nii.gz'))),transforms,interpolator=interp).to_file(str(output))
 if name=='binary':SYNcro.binarize_nifti(str(output))
jac=ants.create_jacobian_determinant_image(fixed,transforms[0],do_log=False,geom=True)
values=jac.numpy();import json
(w/'jacobian.json').write_text(json.dumps({'minimum':float(values.min()),'nonpositive_voxels':int((values<=0).sum()),'voxel_count':int(values.size)}))
print('Propagation reference complete')
