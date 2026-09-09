import pathlib,sys,json,numpy as np,nibabel as nib
w=pathlib.Path(sys.argv[1]);report={}
for name,reference,candidate in [('smoothing','binary-smoothed.nii.gz','web-binary-smoothed.nii'),('binary','reference-binary.nii.gz','web-binary.nii'),('labels','reference-labels.nii.gz','web-labels.nii.gz')]:
 a=nib.load(w/reference);b=nib.load(w/candidate)
 assert a.shape==b.shape;assert np.max(abs(a.affine-b.affine))<1e-4
 difference=abs(a.get_fdata(dtype=np.float32)-b.get_fdata(dtype=np.float32))
 report[name]={'max_absolute_difference':float(difference.max()),'different_voxels':int(np.count_nonzero(difference))}
 assert difference.max()<(1e-6 if name=='smoothing' else 1e-10)
report['fixture']='Synthetic lesion and label fixtures on the real ds000001/sub-01 anatomical grid.'
report['jacobian']=json.loads((w/'jacobian.json').read_text())
assert report['jacobian']['nonpositive_voxels']==0
(w/'propagation-comparison.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
