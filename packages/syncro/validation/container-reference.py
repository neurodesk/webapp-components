"""Run the published Neurodesk SYNcro stages and retain comparison artifacts.

Inside vnmd/syncro_0.1.1:20251216, with this script and dataset bind-mounted.
The only algorithm control added is a fixed ANTs random seed. A single ITK
thread makes the reference reproducible; SynthSR/SynthStrip use --threads.
"""
import argparse, hashlib, importlib.metadata, json, os, pathlib, shutil, subprocess, sys, time
p = argparse.ArgumentParser()
p.add_argument('input'); p.add_argument('output'); p.add_argument('--threads', type=int, default=4)
p.add_argument('--stage', choices=['all','synthsr','synthstrip','registration'], default='all')
a = p.parse_args()
os.environ['ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS'] = '1'
os.environ['ANTS_RANDOM_SEED'] = '42'
os.environ['OMP_NUM_THREADS'] = str(a.threads)
sys.path.insert(0, '/opt')
import SYNcro as reference
import ants
out = pathlib.Path(a.output); out.mkdir(parents=True, exist_ok=True)
def sha(path): return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
report_path = out/'reference.json'
report = json.loads(report_path.read_text()) if report_path.exists() else {
    'input_sha256':sha(a.input), 'script_sha256':sha('/opt/SYNcro.py'),
    'versions':{n:importlib.metadata.version(n) for n in ['antspyx','numpy','scipy','nibabel']},
    'registration':{'type_of_transform':'SyN','random_seed':42,'itk_threads':1}, 'stages':{}}
def stage(name, fn):
    start=time.monotonic(); fn(); report['stages'][name]={'seconds':time.monotonic()-start}
    report_path.write_text(json.dumps(report,indent=2)+'\n');print(name,report['stages'][name],flush=True)
if a.stage in ['all','synthsr']:
    reference.get_num_threads=lambda:a.threads
    report['synthsr_executable']=shutil.which('mri_synthsr') or shutil.which('py_synthsr')
    stage('synthsr', lambda:reference.do_synthsr(a.input,str(out/'synthsr.nii.gz'),False,False))
if a.stage in ['all','synthstrip']:
    stage('synthstrip', lambda:subprocess.run(['mri_synthstrip','-i',str(out/'synthsr.nii.gz'),
        '-o',str(out/'brain.nii.gz'),'-m',str(out/'mask.nii.gz'),'-d',str(out/'sdt.nii.gz'),
        '--threads',str(a.threads)],check=True))
if a.stage in ['all','registration']:
    template='/opt/MNI152_T1_1mm_brain.nii.gz'
    shutil.copyfile(template,out/'template.nii.gz');report['template_sha256']=sha(template)
    def register():
        fixed=ants.image_read(template); moving=ants.image_read(str(out/'brain.nii.gz'))
        result=ants.registration(fixed=fixed,moving=moving,type_of_transform='SyN',random_seed=42,
            outprefix=str(out/'transform-'),verbose=True)
        result['warpedmovout'].to_file(str(out/'warped-brain.nii.gz'))
        original=ants.image_read(a.input)
        warped=ants.apply_transforms(fixed=fixed,moving=original,transformlist=result['fwdtransforms'],
            interpolator='linear',defaultvalue=float(original.min()))
        warped.to_file(str(out/'warped-original.nii.gz'))
        report['transforms']={k:result[k] for k in ['fwdtransforms','invtransforms']}
    stage('registration',register)
report['files']={f.name:sha(f) for f in sorted(out.iterdir()) if f.suffix in ['.gz','.mat']}
report_path.write_text(json.dumps(report,indent=2)+'\n')
