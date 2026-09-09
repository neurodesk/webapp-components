"""Isolate SynthStrip on the exact candidate SynthSR output, including its tensor."""
import pathlib,subprocess,numpy as np,surfa as sf
w=pathlib.Path('/work')
frame=sf.load_volume(w/'web-synthsr.nii.gz')
conformed=frame.conform(voxsize=1.0,dtype='float32',method='nearest',orientation='LIA').crop_to_bbox()
shape=np.clip(np.ceil(np.array(conformed.shape[:3])/64).astype(int)*64,192,320)
conformed=conformed.reshape(shape)
conformed-=conformed.min()
conformed=(conformed/conformed.percentile(99)).clip(0,1)
conformed.data.astype(np.float32).tofile(w/'container-conformed.f32')
subprocess.run(['mri_synthstrip','-i',str(w/'web-synthsr.nii.gz'),'-o',str(w/'isolation-brain.nii.gz'),
 '-m',str(w/'isolation-mask.nii.gz'),'-d',str(w/'isolation-sdt.nii.gz'),'--threads','4'],check=True)
