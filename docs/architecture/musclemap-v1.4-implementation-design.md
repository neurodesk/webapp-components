# MuscleMap v1.4 implementation design

Status: accepted for implementation
Date: 2026-08-27

## Caller view

The browser selects a model by ID. The generated catalog supplies its network, preprocessing, label-space, and asset data.

```js
const model = getModelById(document.getElementById('modelSelect').value);
await inferenceExecutor.run({
  inputData,
  settings: {
    model,
    overlap: selectedOverlap,
    chunkSize: selectedChunkSize,
    useWebGPU
  }
});
```

Generated results carry the model and label-space identity that produced them.

```js
const result = {
  file: sparseUint16Nifti,
  displayFile: classIndexUint8Nifti,
  provenance: {
    modelId: model.id,
    modelVersion: model.modelVersion,
    labelSpaceId: model.labelSpaceId,
    assetSha256: model.asset.sha256
  }
};
```

The release operator runs one staged workflow. Staging and validation do not change production files. Publication records an immutable Hugging Face revision. Activation then generates the runtime catalog, scientific manifest, and components plugin from the same checked-in release descriptor.

```bash
pnpm --filter musclemap models:generate --check
pnpm --filter musclemap model:stage
pnpm --filter musclemap model:validate -- --fixtures /approved/fixtures.json
HF_TOKEN=... pnpm --filter musclemap model:publish
pnpm --filter musclemap model:activate
```

## Data shape

The checked-in release descriptor owns these facts:

- Application version and release state.
- Model ID, model version, and label-space ID.
- Official source URL, record, DOI, filenames, byte counts, MD5, and SHA-256.
- Network and preprocessing parameters from the official JSON.
- Ordered labels with class indices and external anatomical values.
- Derived ONNX precision, byte count, SHA-256, validation report, and immutable published URL.
- Regional-model legacy status.

The official upstream JSON files remain unchanged beside the descriptor. The generator parses and validates both inputs. It rejects these invalid states:

- An active model without an immutable asset revision, byte count, SHA-256, and passing validation report.
- A model whose output count is not the label count plus background.
- Duplicate class indices or external values inside one label space.
- A sparse label space whose external storage cannot hold its largest value.
- More than one active selectable version for a model ID.

Generated browser data uses this shape:

```js
{
  id: 'wholebody',
  filename: 'musclemap-wholebody.onnx',
  label: 'Whole Body',
  modelVersion: '1.4',
  labelSpaceId: 'musclemap-wholebody-v1.4',
  status: 'active',
  legacy: false,
  numClasses: 114,
  roiSize: [256, 256],
  overlap: 0.9,
  padding: 'end',
  asset: {
    url: 'https://huggingface.co/.../resolve/<revision>/musclemap/musclemap-wholebody.onnx',
    bytes: 0,
    sha256: '<64 lowercase hex characters>'
  },
  labels: [
    { index: 0, value: 0, region: '', anatomy: 'background', side: 'none', name: 'Background' }
  ]
}
```

## Module map

- `apps/musclemap/model-sources/` contains the hand-maintained descriptor and verbatim upstream JSON files.
- `apps/musclemap/scripts/generate_model_contracts.mjs` validates the source and generates browser, manifest, and plugin views.
- `apps/musclemap/scripts/model_release.py` acquires, verifies, converts, and validates model candidates from the descriptor.
- `apps/musclemap/scripts/publish_model.py` uploads a selected passing candidate to a content-addressed Storage Bucket prefix and records the publication receipt.
- `apps/musclemap/web/js/app/model-catalog.generated.js` is the browser's generated scientific contract.
- `apps/musclemap/web/js/app/config.js` owns non-scientific UI and runtime defaults and re-exports active models.
- `apps/musclemap/web/js/app/labels.js` owns color generation and label helpers over generated label data.
- `apps/musclemap/web/js/app/label-codec.js` converts external sparse values at the NIfTI boundary.
- `apps/musclemap/web/js/inference-worker.js` keeps the existing pipeline and consumes the model descriptor passed by the main thread.

## Scientific file boundary

Inference, display, cleanup, and metrics use contiguous `Uint8Array` class indices. Official files use sparse anatomical values.

- Export maps class indices to the selected label space and writes `uint16` NIfTI when the maximum external value exceeds 255.
- Import requires a label-space ID and encoding. It maps sparse values back to contiguous indices and rejects unknown nonzero values.
- An unversioned import never inherits the inference model selection.
- Consolidation requires identical label-space IDs, dimensions, and affine geometry.

## Bounded full coverage

Keep the existing full-slice accumulator when it fits the memory budget. Replace the centered-patch fallback with non-overlapping output blocks.

For each block:

1. Find every inference tile that intersects the block.
2. Accumulate only each tile's intersection with the block.
3. Assert that every block pixel has nonzero Gaussian weight.
4. Write the block argmax into the final output slice.

Tiles can run more than once when they intersect multiple blocks. This costs time only on images that exceed the full accumulator budget. It preserves the same weighted result and covers every pixel.

## Release states

`staged` means the source contract exists but the browser cannot select it; the separate publication receipt records whether its candidate has reached a content-addressed remote prefix. `active` means the generated runtime catalog can expose it. `retired` preserves an older contract and its own content-addressed asset prefix for rollback and imported-map attribution.

Activation is one repository change. The generator refuses a partial activation. Rollback activates the prior checked-in descriptor and content-addressed asset prefix. It never deletes a remote asset.

## Synthesis decision

The architecture arena produced two complete candidates. The release-oriented candidate became the base because it fit the current static app and supported incremental delivery. The runtime candidate supplied the strict label-space boundary, versioned result provenance, generated catalog, and block accumulator.

The cross-judge scored the runtime candidate 39 of 45 and the release candidate 35 of 45, but recommended the release candidate as the delivery base. Its staged publication lifecycle and smaller migration path outweighed the runtime candidate's broader facade rewrite.

The design rejects a new TypeScript runtime, a full worker decomposition, and a second runtime manifest loader. Those changes would enlarge the migration without improving v1.4 parity. The existing worker remains until a separate refactor can prove identical behavior.

## Verification

The generator must be idempotent and support `--check`. Unit tests exercise descriptor invariants, label encoding, import rejection, geometry compatibility, tile coverage, and checksum verification. Model validation compares approved MR and CT fixtures against upstream PyTorch before publication. The release build runs real WASM inference and WebGPU inference on a capable runner.
