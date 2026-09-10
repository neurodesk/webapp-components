# musclemap

## 1.4.7

### Patch Changes

- Apply the shared design system and the registry-driven About and Cite dialogs. Every app now states that it is developed and hosted by the Neurodesk team, lists the packages under the hood, names the lightning.org ecosystem, and cites one paper per implemented method plus the Neurodesk platform paper. SynthSR, SYNcro, Deface, BrowserQC and NiiMath use the shared workspace vocabulary (compact sections, one scan picker, shared toolbar, status bar and dialogs).
- Updated dependencies
  - @neurodesk/webapp-components@0.1.3

## 1.4.6

### Patch Changes

- Restore the MuscleMap segmentation overlay by preserving label indices when the shared viewer configures the segmentation display range. Add regression coverage for the label-to-colormap mapping.

## 1.4.5

### Patch Changes

- cd790d5: Finish shared imaging convergence by centralizing worker sessions, input handling, app-specific controllers, workspace styles, and runtime clients. Strengthen shell contracts and regression coverage.

## 1.4.4

### Patch Changes

- 5560336: Consolidate imaging workers, pipeline execution, viewer behavior, NIfTI serialization, runtime wrappers, shared styling, and hosted shell controls. Fix CALMaR analysis startup and layout, and remove horizontal overflow from Deface controls.

## 1.4.3

### Patch Changes

- Keep ONNX Runtime inside the MuscleMap service worker scope so all available WebAssembly threads can start on GitHub Pages.

## 1.4.2

### Patch Changes

- Keep whole-body v1.3 available as a legacy model without changing the v1.4 default.

## 1.4.1

### Patch Changes

- Prepare the official whole-body MuscleMap v1.4 model as a gated release. Canonical upstream model contracts now generate all runtime and registry metadata.
- Preserve official sparse anatomical labels in downloaded NIfTI files and require explicit label-space attribution for imported segmentations.
- Verify remote model bytes by SHA-256 and replace the large-slice centered fallback with bounded full-coverage accumulation.
- Add reproducible conversion, MR/CT fidelity validation, atomic publication, anonymous verification, activation, and rollback-friendly v1.3 retirement tooling.
- Match v1.4 upstream inference with affine-aware MONAI geometry, source-axis preprocessing chunks, logit-space inverse transforms, Gaussian scan intervals, and 6-connected component cleanup; gate release on a full browser-to-upstream volume comparison.
- Analyze uploaded segmentation NIfTI files without model inference, auto-detect browser, official, and OpenRecon int12 label encodings, and provide normalized official-label downloads.
- Make the validated FP32 whole-body v1.4 model the default selectable model.

## 1.2.43

### Patch Changes

- 90762b0: Fix ONNX Runtime WASM URLs in composite-site builds so inference loads the shared runtime without duplicating the `/_runtime/` path.

## 1.2.42

### Patch Changes

- 46be48e: Add a persistent light and dark theme switch to the webapp catalog and every hosted or standalone webapp bundle.

## 1.2.41

### Patch Changes

- Standardize the Neurodesk app shell and add DNT/GPC-respecting page-view analytics with aggregate per-app usage statistics.

## 1.2.40

### Patch Changes

- Align the application interfaces with the Neurodesk design system and point app source links at the webapps monorepo.

## 1.2.39

### Patch Changes

- 4a4dd72: Apply the Neurodesk designer-guide theme to hosted and standalone webapp bundles.
