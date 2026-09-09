"""Additional QC inside the reference container after extracting the browser ZIP."""
import os
os.environ['ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS']='1'
import json,pathlib,numpy as np,ants
w=pathlib.Path('/work');out=w/'browser/outputs'
fixed=ants.image_read(str(w/'reference/template.nii.gz'))
jac=ants.create_jacobian_determinant_image(fixed,str(out/'1Warp.nii.gz'),do_log=False,geom=True).numpy()
report={'jacobian':{'minimum':float(jac.min()),'nonpositive_voxels':int((jac<=0).sum())},'labels':{}}
assert report['jacobian']['nonpositive_voxels']==0
reference=ants.image_read(str(w/'reference-labels.nii.gz')).numpy()
candidate=ants.image_read(str(out/'warped-2-labels.nii.gz')).numpy()
for label in [3,7]:
 a=reference==label;b=candidate==label
 dice=float(2*np.count_nonzero(a&b)/(np.count_nonzero(a)+np.count_nonzero(b)))
 report['labels'][label]={'dice':dice,'reference_voxels':int(a.sum()),'candidate_voxels':int(b.sum())}
 assert dice>0.95
(w/'browser/qc.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
