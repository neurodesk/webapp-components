import synthsrManifest from '../../synthsr/model.manifest.json' with {type:'json'};
const synthsrAsset=synthsrManifest.assets.find(asset=>asset.filename==='synthsr-v2.onnx');
import syncroManifest from '../../../models/syncro.manifest.json' with {type:'json'};
export const assets={
  synthsr:{...synthsrAsset,url:synthsrManifest.base_url+synthsrAsset.filename},
  synthstrip:{url:'https://huggingface.co/datasets/sbollmann/neurodesk-webapps-assets/resolve/a8cdbf8c2874e1a2f617ecc6695244a0810eac11/vesselboost/synthstrip.onnx',sha256:'7b8eeecf3793a6c4510b9f5270ecc03d9c3262d26e08d568203a651ab4b84074',bytes:10294211},
};
const published=name=>{const asset=syncroManifest.assets.find(a=>a.filename===name);return {...asset,url:syncroManifest.base_url+name};};
export const browserSynthstrip=published('synthstrip-browser.onnx');
export const templateAsset=published('MNI152_T1_1mm_brain.nii.gz');
