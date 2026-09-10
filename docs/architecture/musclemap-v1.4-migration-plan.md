# MuscleMap whole-body model v1.4 migration plan

Status: ready for implementation planning review
Prepared: 2026-08-27
Rigor: high

## Executive decision

Upgrade the browser app from the whole-body v1.3 scientific contract to the official whole-body v1.4 model, while retaining the five regional v0.0 models as clearly marked legacy options.

There is no MuscleMap Git tag or GitHub release named `1.4`. The exact target is therefore the following pair:

- Model checkpoint and JSON: Zenodo record [21929873](https://zenodo.org/records/21929873), version 1.4, DOI `10.5281/zenodo.21929873`.
- Upstream inference behavior and documentation: MuscleMap commit [`6e1e1eb6732337c13cab53bd5cc800c69024774f`](https://github.com/MuscleMap/MuscleMap/commit/6e1e1eb6732337c13cab53bd5cc800c69024774f), which merged [PR 88](https://github.com/MuscleMap/MuscleMap/pull/88).

The upstream repository calls its application release `2.0`. This webapp should not claim to be a port of the upstream desktop application. It should expose app version `1.4.1` and model version `1.4` as separate values.

Do not switch the deployed app to the new asset until the converted model, browser pipeline, label encoding, and representative MR and CT outputs pass the release gates in this document.

The pinned Zenodo source artifacts are:

| File | Bytes | Published digest |
| --- | ---: | --- |
| `contrast_agnostic_wholebody_model.pth` | 104,884,148 | MD5 `910b722aeb641c380404c99ec6d1af97` |
| `contrast_agnostic_wholebody_model.json` | 10,555 | MD5 `b586ac488b2e40a4e8624a9a1c52d6b5` |
| `LICENSE` | 1,087 | Verify from the record during acquisition |

The acquisition job must also calculate and record SHA-256 because the local and Hugging Face manifests use SHA-256.

## Verified starting point

The current browser model contract matches upstream whole-body v1.3:

- 100 output channels including background.
- 99 foreground structures.
- One residual unit.
- A 256 by 256 inference window.
- The v1.3 label order and sparse anatomical values.

The current app has independent `1.2.x` application version strings. Those strings do not identify the scientific model version. The current ONNX asset was uploaded before the v1.4 model release, and the repository does not record a reproducible source-checkpoint-to-ONNX lineage.

The app downloads six ONNX files from Hugging Face dataset revision `a8cdbf8c2874e1a2f617ecc6695244a0810eac11`. The current whole-body asset is 26,888,722 bytes with SHA-256 `3bff6e22e54d3d7399247d5e71d6423c91bb636d86ab21e0dd929524afbc2bc7`. Record this revision and digest as the rollback baseline. The whole-body model is active. Abdomen, forearm, leg, pelvis, and thigh are upstream legacy v0.0 models retained for backward compatibility.

## Upstream v1.4 delta

### Network contract

| Field | Current whole-body v1.3 | Target whole-body v1.4 |
| --- | ---: | ---: |
| Output channels, including background | 100 | 114 |
| Foreground labels | 99 | 113 |
| Residual units | 1 | 2 |
| ROI | 256 by 256 | 256 by 256 |
| Channels | 64, 128, 256, 512, 1024 | unchanged |
| Strides | 2, 2, 2, 2 | unchanged |
| Normalization | instance | unchanged |
| Pixel spacing | 1, 1, preserve slice axis | unchanged |

The official v1.4 distribution contains a PyTorch checkpoint and JSON configuration. It does not contain an official ONNX file, ONNX checksum, conversion recipe, or reference output. The browser ONNX is therefore a derived artifact whose fidelity must be measured before publication.

### Label contract

The change is not a safe append of 14 labels. Lower-leg label meanings and sparse values change beginning at class index 86. A result must carry its model version and label-space identity. Historical v1.3 and new v1.4 results must never be joined by sparse value alone.

The target classes from index 86 are:

| Indices | Sparse values | v1.4 anatomy |
| --- | --- | --- |
| 86, 87 | 7231, 7232 | Patella, left and right |
| 88, 89 | 8101, 8102 | Tibialis anterior, left and right |
| 90, 91 | 8111, 8112 | Tibialis posterior, left and right |
| 92, 93 | 8121, 8122 | Peroneus longus, left and right |
| 94, 95 | 8131, 8132 | Soleus, left and right |
| 96, 97 | 8141, 8142 | Medial gastrocnemius, left and right |
| 98, 99 | 8151, 8152 | Lateral gastrocnemius, left and right |
| 100, 101 | 8161, 8162 | Tibia, left and right |
| 102, 103 | 8171, 8172 | Fibula, left and right |
| 104, 105 | 8181, 8182 | Flexor hallucis longus, left and right |
| 106, 107 | 8191, 8192 | Extensor digitorum / hallucis longus, left and right |
| 108, 109 | 8201, 8202 | Flexor digitorum longus, left and right |
| 110, 111 | 8211, 8212 | Popliteus, left and right |
| 112, 113 | 8221, 8222 | Plantaris, left and right |

The JSON configuration is authoritative when a README label differs. It also corrects `lattisimus` to `latissimus dorsi` and `tensor fascia latae` to `tensor fasciae latae`.

### Inference contract

The target upstream pipeline uses:

- RAS orientation.
- In-plane spacing of 1 mm, preserving slice spacing.
- Nonzero intensity normalization.
- Foreground cropping with margin 20.
- End padding to at least 256 by 256 by 1.
- Gaussian-weighted 2D sliding-window inference.
- 90 percent overlap by default.
- Inversion to source geometry, argmax, sparse-value remapping, and largest-connected-component cleanup.

PR 88 did not introduce a new inference algorithm. It changed the whole-body checkpoint and metadata. The browser still needs to reconcile older divergences from the current upstream behavior because those divergences can affect v1.4 parity.

## Gaps in the current webapp

### Release-blocking scientific gaps

1. Conversion is not reproducible. The shell script downloads mutable GitHub `main` paths, hardcodes `100|256|1`, accepts unchecked cached checkpoints, and runs in an unpinned environment.
2. Validation is advisory. The converter can warn about a failed argmax comparison and still exit successfully. The comparison utility is manual, defaults to 50 percent overlap, and hardcodes one residual unit for PyTorch.
3. Runtime metadata is duplicated across the model manifest, browser configuration, labels, HTML, and components plugin. A 114-channel asset can be paired accidentally with a 100-label UI.
4. The app exports contiguous class indices as `uint8`. Official MuscleMap outputs use sparse anatomical values up to 8222 and require `uint16`.
5. Imported values at or above 256 are discarded. An official v1.4 label map cannot round-trip through the current app.
6. Consolidation votes on raw indices and checks only dimensions. Combining different model label spaces can silently produce anatomically incorrect output.
7. The worker's full accumulation limit is a fixed 100 million elements. Increasing classes from 100 to 114 lowers the maximum fully covered slice from 1,000,000 to 877,192 pixels. Larger slices can enter a centered-patch fallback that omits peripheral anatomy.
8. Cached models are trusted based on size greater than 1 MB. The runtime does not verify the manifest byte count or SHA-256 digest before creating a session.
9. Existing automated tests do not exercise real model conversion, preprocessing, worker inference, postprocessing, label encoding, or model cache integrity.

### Product and provenance gaps

- The UI says MRI only and 99 muscles. V1.4 supports MR sequences and CT and defines 113 muscles and bones. Use the concise product term `113 structures`.
- Region models are presented as peers rather than legacy v0.0 compatibility options.
- App versions are split among package `1.2.43`, runtime `1.2.37`, and cache-busting imports `1.2.35`.
- The runtime does not display or persist the model version, source DOI, source checkpoint digest, converter version, or ONNX digest.
- Documentation says models are bundled or committed even though the build strips them and deployment audits reject bundled model files.
- The app license lacks the upstream MuscleMap copyright notice, and the asset manifest reports `NOASSERTION` instead of per-asset source and license metadata.

## Target design

### Canonical model descriptor

Check in the official v1.4 JSON unchanged, along with a small source descriptor that records:

- Model ID and display name.
- `modelVersion` and a stable `labelSpaceId`.
- Legacy status.
- Zenodo record, DOI, filenames, byte counts, and upstream MD5 values.
- A locally calculated SHA-256 for every downloaded source and derived asset.
- Upstream commit and license.
- Network architecture and preprocessing values.
- Ordered labels with class index, sparse value, region, anatomy, side, and display name.
- Published Hugging Face revision, asset filename, byte count, and SHA-256.

A deterministic generator should derive the browser model catalog, labels, scientific manifest fields, and components plugin metadata from these descriptors. CI should fail if generated files are stale or if a model's class count differs from its label count plus background.

The browser should render the model selector from the generated catalog instead of maintaining hardcoded HTML options.

### Label-space boundary

Use contiguous class indices internally for logits, display buffers, and per-model computation. Convert only at explicit file boundaries:

- Export official sparse anatomical values as `uint16` NIfTI.
- Import official sparse values by mapping them to the selected descriptor's internal class indices.
- Reject unknown nonzero values instead of truncating them.
- Read `labelSpaceId` from a trusted NIfTI extension or adjacent provenance sidecar when available. If an imported map has no trusted identity, require an explicit v1.3, v1.4, or regional label-space choice. Never infer it from the model currently selected for inference.
- Mark an explicitly classified but unversioned import as user-attributed provenance. Reject metrics and consolidation until the attribution has been recorded with the result.
- Record `modelId`, `modelVersion`, `labelSpaceId`, ONNX SHA-256, and source geometry with every result and metrics export.
- Permit consolidation only when inputs have the same label-space identity and compatible geometry. Reject cross-model voting until an explicit, reviewed anatomical mapping exists.

### Reproducible conversion and publication

Replace hardcoded conversion flags with configuration loaded from the pinned upstream JSON. Pin the conversion environment to the upstream baseline of Python 3.11.8, PyTorch 2.4.1, and MONAI 1.3.2. Pin compatible ONNX and ONNX Runtime versions after the first successful isolated conversion instead of inheriting developer-machine versions.

Build both FP32 and dynamically quantized candidates in staging. Publish the quantized candidate only if it passes fidelity and browser-performance gates. Otherwise publish FP32. Users should see one validated whole-body model, not an unexplained precision choice.

The publishing command must:

1. Refuse to run unless all local validation outputs are current for the exact source and derived digests.
2. Read a short-lived credential only from the standard `HF_TOKEN` environment variable.
3. Upload the selected whole-body ONNX and provenance sidecar together under a content-addressed Hugging Face Storage Bucket prefix. The unchanged regional assets remain available under their existing prefix.
4. Record the bucket and content-addressed prefix in the publication receipt.
5. Download the asset anonymously from that prefix and verify its byte count and SHA-256.
6. Regenerate the checked-in manifest and runtime catalog with the pinned bucket URL.

Never pass the token as a command argument or write it to source, configuration, shell history, logs, browser code, or generated artifacts.

### Runtime coverage and integrity

Replace the centered-patch fallback with bounded-memory tiling or striped accumulation that still visits every tile. The implementation must prove full spatial coverage for images above and below the current 100-million-element threshold.

Verify asset size and SHA-256 before caching or loading. Derive the cache key from the immutable asset URL and checksum, not from the app version. A checksum mismatch must evict the entry, retry once from the pinned URL, and fail clearly if the second download differs.

## Implementation sequence

Each unit should land in a verifiable state. A release branch may be temporarily incomplete, but no deployable commit may pair a 114-channel model with the old 100-class contract.

### Unit 0: Establish the baseline and verification scaffold

Deliverables:

- Obtain one representative, deidentified MR volume and one representative, deidentified CT volume whose use in local validation and CI is approved. If redistribution is not permitted, store only access instructions and expected digests, and run the full fixture gate in a controlled release job.
- Record a fixture coverage matrix. Across the approved fixture set, the upstream v1.4 reference must contain every changed or new class from 86 through 113. A class absent from all reference outputs is unvalidated and blocks publication unless a separately approved fixture covers it.
- Add a small synthetic NIfTI fixture for deterministic geometry, label encoding, and coverage tests. Synthetic data is not a substitute for MR and CT parity.
- Run the current browser ONNX and an upstream v1.3 PyTorch reference on the representative fixtures. Record output digests, timings, memory, and environment details as the rollback baseline.
- Add tests for descriptor consistency, sparse `uint16` NIfTI round-trip, unknown-value rejection, consolidation compatibility, and full tile coverage.
- Add a scriptable worker or browser harness that runs a real ONNX session with WASM. Use WebGPU where the release runner supports it.

Gate: baseline reports are reproducible from documented commands and the new tests fail for the known v1.4 incompatibilities.

### Unit 1: Introduce the canonical scientific contract

Deliverables:

- Vendor the official v1.4 JSON unchanged and record its Zenodo provenance and checksums.
- Add descriptors for whole-body v1.4 and the five legacy regional models.
- Mark the new descriptor `staged` until publication. The generated production catalog must expose only `active` descriptors.
- Add the deterministic contract generator and stale-generated-file check.
- Generate runtime configuration, labels, manifest metadata, and plugin metadata.
- Render model choices from the catalog and label the regional models as legacy v0.0.

Gate: 114 output channels, 113 ordered labels, two residual units, all sparse values, and all generated consumers agree. The generator is idempotent. CI rejects activation unless the descriptor has the validated immutable asset URL, byte count, SHA-256, and final comparison-report digest.

### Unit 2: Make whole-body conversion reproducible

Deliverables:

- Add a locked conversion environment and record tool versions in the provenance sidecar.
- Download the exact Zenodo checkpoint and JSON, verify expected size and digest before use, and avoid mutable URLs.
- Make the converter construct the model from descriptor fields.
- Convert only whole-body v1.4. Do not reconvert unchanged regional models.
- Produce FP32 and Q8 candidates with deterministic filenames and SHA-256 reports.
- Turn all structural and numerical validation failures into nonzero exits.

Gate: a clean environment produces structurally valid ONNX candidates with 114 outputs and recorded lineage from source checkpoint through converter commit to output digest.

### Unit 3: Select the browser asset by measured fidelity

Use upstream commit `6e1e1eb` and its v1.4 PyTorch path as the reference. Run the same MR and CT fixtures through upstream PyTorch, Python ONNX Runtime, browser WASM, and browser WebGPU where available.

Initial technical fidelity gates:

- FP32 seeded-patch logits match PyTorch with `rtol=1e-4` and `atol=1e-4`.
- Whole-volume ONNX labels have at least 99 percent voxel agreement with the upstream reference.
- Every foreground label present in the reference has Dice at least 0.95, and no present reference label disappears.
- Browser WASM and WebGPU meet the same whole-volume label gates against Python ONNX Runtime.
- Q8 must meet all gates and provide a material download, memory, or latency improvement. Otherwise select FP32.

These thresholds verify conversion and integration fidelity. They do not establish clinical accuracy or replace upstream validation.

Gate: one candidate is selected in a signed-off comparison report. No asset has been uploaded yet.

### Unit 4: Align the browser pipeline and output semantics

Deliverables:

- Consume all inference parameters from the selected descriptor, including 114 classes.
- Change default overlap to 90 percent.
- Match upstream end padding and reconcile transform inversion and connected-component cleanup until the representative fixture gates pass.
- Replace the centered fallback with bounded full-coverage accumulation.
- Keep internal class indices contiguous and export sparse `uint16` official values.
- Normalize imported official label maps through the selected label-space descriptor.
- Persist model and geometry provenance with inference results and metrics.
- Reject consolidation across different label spaces or incompatible geometries.

Gate: MR and CT browser outputs pass Unit 3 thresholds; sparse export/import round-trips exactly; coverage tests prove that every input pixel participates in inference; incompatible consolidation fails with an actionable message.

### Unit 5: Update product surface, versions, documentation, and notices

Deliverables:

- Set the webapp package version to `1.4.1` and generate runtime and cache-busting versions from that one source.
- Display app version and scientific model version separately.
- Describe whole-body v1.4 as 113 structures from anatomical MRI or CT.
- Keep IMF controls explicitly modality-specific.
- Mark regional models as legacy v0.0.
- Link the model DOI and record the upstream source commit in the About surface and README.
- Correct model-hosting, conversion, and release instructions.
- Add the upstream MuscleMap MIT notice and per-asset provenance and license fields.

Gate: no stale `1.2.35`, `1.2.37`, `99 muscles`, MRI-only, bundled-model, or `NOASSERTION` claims remain for the new whole-body asset.

### Unit 6: Publish and pin the validated asset

Deliverables:

- Run the gated publisher with a rotated short-lived credential supplied as `HF_TOKEN`.
- Upload only the selected ONNX and provenance sidecar in one bucket batch under the candidate digest prefix.
- Verify anonymous download size and SHA-256 from the recorded content-addressed prefix.
- Regenerate and commit the manifest and runtime catalog with that prefix.
- Change the whole-body descriptor from `staged` to `active` only in this atomic repository update.
- Run the repository's manifest validation and a remote asset audit.

Gate: a clean browser session downloads the exact manifest-pinned bytes, verifies them, caches them under the checksum-derived key, and creates a session on supported WASM and WebGPU paths.

### Unit 7: Release and rollback drill

Deliverables:

- Run unit tests, Python tests, Playwright tests, standalone and composite builds, artifact audits, and real-model browser smoke tests.
- Exercise inference, sparse export/import, metrics, and same-label-space consolidation on the deployed preview.
- Confirm that no checkpoint, ONNX asset, validation fixture without redistribution approval, or credential is bundled in the web artifact or Git history.
- Before release, record the prior app commit, composite deployment artifact, standalone release tag or archive, Hugging Face revision, and expected cache key.
- Test rollback through the same production deployment topology used for the release, including the composite site and any enabled Cloudflare deployment. A preview-only rollback is insufficient.
- Tag the completed app release as `musclemap-v1.4.1` under the repository's normal release convention.

Gate: all definition-of-done checks pass on the deployed release candidate and the production-path rollback drill restores v1.3 behavior without cache contamination.

## Verification matrix

| Concern | Test level | Required evidence |
| --- | --- | --- |
| Source authenticity | Conversion job | Zenodo record, filename, bytes, MD5, calculated SHA-256 |
| Architecture | Converter and ONNX inspection | 114 outputs, two residual units in source construction, dynamic batch and spatial axes |
| Label order and values | Generated-contract test | Exact equality with official JSON |
| Conversion precision | Python reference comparison | Patch logit report and MR/CT whole-volume Dice report |
| Browser execution | Browser harness | WASM required; WebGPU required on a capable runner |
| Preprocessing and inversion | End-to-end parity | Output shape, affine, orientation, and labels match source geometry and reference thresholds |
| Large-slice coverage | Deterministic unit/integration test | Each tile and boundary pixel covered above and below memory threshold |
| Export/import | NIfTI round-trip | Sparse `uint16` values preserved exactly |
| Consolidation safety | Unit and browser test | Same label space accepted; mismatched label space or geometry rejected |
| Asset integrity | Runtime and release job | Anonymous bytes and SHA-256 match manifest before session creation |
| Secret handling | Artifact and Git scan | No token-like value in tracked files, bundle, logs, or generated metadata |
| Rollback | Production-path deployment drill | Previous composite and standalone artifacts run with their original immutable model URL and cache key |

## Definition of done

The migration is complete only when all of these claims are demonstrated:

1. The whole-body descriptor exactly represents official v1.4: 114 channels, 113 ordered foreground labels, two residual units, and the official sparse values.
2. The selected ONNX has a complete provenance chain and passes the MR and CT fidelity gates against upstream v1.4 PyTorch. The fixture coverage matrix includes every changed or new class from 86 through 113.
3. Anonymous downloads from the pinned Hugging Face revision match the checked-in byte count and SHA-256, and the asset creates browser sessions on WASM and WebGPU.
4. Exported segmentations use official sparse `uint16` values, and export/import round-trips without loss.
5. Historical and current results carry model and label-space identity. Unversioned imports require explicit attribution and do not inherit the active inference model. Cross-label-space or incompatible-geometry consolidation is rejected.
6. Large slices receive complete spatial coverage without exceeding the bounded-memory policy.
7. The app has one generated application version, displays model version separately, and accurately describes 113 structures, MR and CT support, and legacy regional models.
8. Standalone and composite builds, tests, artifact audits, real-model browser smoke tests, and the rollback drill pass.
9. No credential or unapproved fixture is present in source, Git history, logs, generated files, or web artifacts.

## Affected repository areas

Expected modifications:

- `apps/musclemap/scripts/convert_all_models.sh` or its replacement, `convert_model.py`, and `compare_inference.py`.
- A new pinned conversion environment, source descriptors, generator, validation policy, publisher, and remote asset audit.
- `models/musclemap.manifest.json`.
- `apps/musclemap/web/js/app/config.js`, `labels.js`, `inference-worker.js`, `musclemap-app.js`, file I/O, viewer, and metrics/consolidation paths.
- `apps/musclemap/web/index.html`, README, changelog, license, package version, and release documentation.
- `apps/musclemap/web/js/controllers/MuscleMapPipeline.js` and the shared pipeline interfaces it consumes.
- Focused Node, Python, and Playwright tests plus approved validation-fixture metadata.

Keep model-specific inference policy in the app worker. Put message transport, model fetching, NIfTI I/O, and generic volume operations in `@neurodesk/webapp-components` so the app does not fork infrastructure code.

Expected size is 15 to 20 modified files, 4 to 8 new scripts, descriptors, fixtures, or tests, and 6 to 8 independently verifiable commits. A reasonable implementation estimate is 4 to 7 engineering days once approved MR and CT fixtures are available. Conversion benchmarks and WebGPU availability can extend elapsed time.

## Dependencies and open decisions

### Blocking dependency

The team needs approved representative MR and CT validation inputs. Across the fixture set, the upstream reference must produce every changed or new class from 86 through 113. Without modality and changed-label coverage, scientific parity is unverified and the model must not be published as the release asset. If inputs cannot be committed, establish a controlled release job that resolves them by digest.

### Decisions to record during implementation

- FP32 or Q8: choose from Unit 3 evidence, with FP32 as the fallback.
- Exact compatible ONNX and ONNX Runtime Python versions: pin the first pair that passes clean-environment conversion and browser parity.
- Fixture location: repository, private object storage, or controlled runner, according to data approval.
- Whether to preserve the current regional-model UI or move legacy models behind an advanced control. Keeping them visible but clearly marked is the lowest-risk migration choice.

## Risks and rollback

| Risk | Control |
| --- | --- |
| A valid ONNX produces different anatomy | MR and CT comparison against upstream PyTorch before upload |
| Q8 degrades small new lower-leg structures | Per-present-label Dice and no-disappearing-label gates; FP32 fallback |
| New class count triggers partial slice coverage | Bounded full-coverage tiling and threshold-crossing tests |
| Sparse values overflow or are truncated | Explicit internal/external boundary and `uint16` round-trip tests |
| Old and new label semantics are mixed | Stable label-space IDs and consolidation rejection |
| CDN or cache serves wrong weights | Content-addressed prefix, byte count, SHA-256 verification, checksum cache key |
| Publication leaves a mixed asset set | One bucket batch under the candidate digest prefix; anonymous post-upload audit |
| Token leaks | Environment-only short-lived credential, secret scans, and rotation |
| Browser migration expands into a risky rewrite | Keep the worker structure unless a small extraction is needed for a tested invariant |

Rollback does not delete or overwrite the old asset revision. Redeploy the recorded prior composite artifact and standalone release through the production deployment path, restoring the prior app commit and its existing immutable Hugging Face revision. Checksum-derived cache keys prevent the v1.4 model from satisfying a v1.3 request. Preserve validation reports and both revisions so the failed release can be investigated without blocking restoration.

## Reproducing the investigation

These read-only commands reconstruct the main upstream and local facts. Save command output with the implementation's baseline report.

```bash
git ls-remote --tags https://github.com/MuscleMap/MuscleMap.git
curl --fail --location --silent https://api.github.com/repos/MuscleMap/MuscleMap/pulls/88
curl --fail --location --silent https://zenodo.org/api/records/19976940
curl --fail --location --silent https://zenodo.org/api/records/21929873
git show HEAD:models/musclemap.manifest.json
rg -n 'out_channels|num_res_units|numClasses|INDEX_TO_VALUE|100_000_000|single centered patch' apps/musclemap models/musclemap.manifest.json
```

Download the v1.3 and v1.4 JSON files from their Zenodo record API links and compare them structurally. Verify the published byte counts and MD5 values, then calculate SHA-256 locally. Compare the local label array with the v1.3 JSON by ordered class index and sparse value, not by display name alone.

## Evidence sources

- [MuscleMap upstream repository](https://github.com/MuscleMap/MuscleMap)
- [Wholebody model v1.4 pull request](https://github.com/MuscleMap/MuscleMap/pull/88)
- [Pinned upstream merge commit](https://github.com/MuscleMap/MuscleMap/commit/6e1e1eb6732337c13cab53bd5cc800c69024774f)
- [Official Zenodo whole-body model v1.4 record](https://zenodo.org/records/21929873)
- [Upstream README at the pinned commit](https://github.com/MuscleMap/MuscleMap/blob/6e1e1eb6732337c13cab53bd5cc800c69024774f/README.md)
- [Upstream MIT license](https://github.com/MuscleMap/MuscleMap/blob/6e1e1eb6732337c13cab53bd5cc800c69024774f/LICENSE)

The local decision trail for this investigation is `.audit/musclemap-v1.4-plan.tsv`.
