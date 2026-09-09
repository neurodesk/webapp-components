export const NIIMATH_EXAMPLE_BASE_URL =
  'https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/49b12b87f4e5def9672cf582b93ecd4a54273608/niimath/';

const DEMO_BASE_URL = 'https://niivue.github.io/niivue-demo-images/';

export const NIFTI_EXAMPLES = [
  ['fa8', NIIMATH_EXAMPLE_BASE_URL],
  ['dwi16', NIIMATH_EXAMPLE_BASE_URL],
  ['fmri32', NIIMATH_EXAMPLE_BASE_URL],
  ['T1w7T', NIIMATH_EXAMPLE_BASE_URL],
  ['T2w7T', NIIMATH_EXAMPLE_BASE_URL],
  ['bold7T', NIIMATH_EXAMPLE_BASE_URL],
  ...['chris_PD', 'chris_t1', 'chris_t2', 'CT_Abdo', 'CT_Electrodes',
    'CT_Philips', 'CT_pitch', 'fmri_pitch', 'Iguana', 'mni152', 'MR_Gd',
    'spm152', 'spmMotor'].map(id => [id, DEMO_BASE_URL]),
].map(([id, base]) => ({ id, url: `${base}${id}.nii.gz`, modality: id.startsWith('CT_') ? 'ct' : 'mr' }));
