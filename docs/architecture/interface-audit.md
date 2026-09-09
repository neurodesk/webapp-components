# Interface consistency audit

All 14 registered apps were reviewed on 8 September 2026, starting from `c514f87d`. The identified interface changes are implemented. Production workspaces were checked at 1440 × 900 and 390 × 844, with additional narrow-phone, landscape, and tablet checks.

## Changes by app

| App | Implemented behavior |
| --- | --- |
| QSMbly | Native buttons replace mouse-only headings, including Refine Mask. Accordion grouping and workflow-driven expansion remain. The technical log starts collapsed and opens for errors or the mobile Console tab. |
| MuscleMap | Inference tuning and the technical log start collapsed. Section buttons support keyboard activation and retain inputs. Shared navigation replaces repeated footer links. |
| VesselBoost | Optional downsampling, bias correction, denoising, and brain extraction start collapsed. Segmentation remains available. Section controls and the technical log use the shared accessible binding. Footer navigation is consolidated. |
| Spinal Cord Toolbox | Task selection and Run remain available. Advanced segmentation settings and later processing start collapsed. Disabled steps are inert. Threshold values survive closing and reopening after import. Footer navigation is consolidated. |
| CALMaR | Empty Results start collapsed, open after analysis, and close on reset. Section buttons support keyboard activation. Existing advanced settings and detailed log remain collapsible. Footer navigation is consolidated. |
| SeedSeg | Compact inference defaults remain. Native section buttons replace mouse-only headings, the technical log starts collapsed, and footer navigation is consolidated. |
| dicompare | Runtime status occupies normal document space instead of covering the phone workspace. Loading details start collapsed. Workflow cards expose expanded state, and acquisition titles are keyboard-accessible buttons with truncated long names. |
| Deface | Output starts collapsed and opens when the processed image loads. Method help is shorter. The shared bar owns the About action. |
| Easy MP2RAGE | Task selection sits beside input. Sequence parameters and the example image start collapsed. Parameter families follow the selected task, and denoising hides sequence parameters. About contains the full methods and credits. Tutorial and Reset sit beside input. Validation reveals its fields and log; the tutorial opens the panel containing its target. |
| NiiMath | Input and Processing use native disclosures. Overlay appearance, Output, and Example images start closed. Processing reveals Output on success. The shared About action retains the scientific documentation handler. |
| MRI2VID / dicom2vid | Compact input instructions keep file and folder pickers distinct. Extended credits and privacy text live in dialogs connected to the shared bar. Dialogs scroll and close on phones. |
| BrowserQC | Empty Results start collapsed and open on completion or QC failure. Initial processing help is shorter. The shared bar owns About, with a standalone fallback outside the Results panel. |
| SurfAnnotate | Surfaces stay open. Overlay, annotation, ROI, and export controls start collapsed. The first surface opens overlay and annotation controls; ROI creation or filling reveals export. Panels use shared spacing and full sidebar width. |
| ZARRo | Source selection stays open. Navigate, Display, and Measure & Export start collapsed. The first loaded volume opens Navigate and Display. Advanced settings remain collapsed, and touch measurement and export remain available. |
| SynthSR | The upload control is 44px tall, with a compact input heading. Example images load on selection, excluding CT_Abdo, CT_Electrodes, Iguana and spmMotor. Scaled negative voxels select CT; otherwise MRI, with a manual override. WebGPU is the default. Processing settings and unavailable outputs start collapsed; completed synthesis opens Output and reveals the Synthetic T1 tab. Loading a new image hides that tab. Terminal help is reduced to curl, local installation and one run command. Browser tests cap upload height at 48px and initial input-section height at 220px. |

## Rules and enforcement

Scan fields now accept NIfTI and DICOM through the same multi-file picker, including extensionless DICOM instances. SynthSR converts locally, provides a series selector, and supports cancellation and retry. NiiMath, Deface, and BrowserQC share the bundled image importer. Easy MP2RAGE routes its main picker through its existing DICOM parser and rejects mixed series instead of assembling unrelated scans. CALMaR's structural, lesion, DWI, ADC, and manual-mask fields and QSMbly's mask field support conversion. SeedSeg and QSMbly no longer filter out DICOM filename variants.

Static apps retain a checksum-verified DICOM runtime inside each app's service-worker scope. GitHub Pages does not supply isolation headers for workers outside that scope. The DICOM browser suite serves the site without isolation headers and waits for the service-worker reload, reproducing the deployed environment instead of masking this requirement with local-server headers.

Every file input declares its scientific purpose. Scan fields are checked by `audit:interfaces` for multi-file selection and unrestricted filenames. Surface and per-vertex overlays in SurfAnnotate, acquisition protocols in dicompare, and OME-Zarr datasets in ZARRo retain their specialized inputs. Model weights, BIDS directories, schemas, and gradient tables remain separate input types.

Root `AGENTS.md` requires [the interface standard](interface-standard.md) for existing and new apps. The standard defines navigation ownership, disclosure defaults, state preservation, touch controls, and completion checks.

The shared shell hides registered duplicate information triggers while retaining their handlers and standalone fallbacks. Shared native disclosures and `bindSectionDisclosures` preserve control identity, synchronize workflow expansion, and remove closed content from keyboard navigation. The new-app template uses these components and a collapsed technical log; its documentation mirror matches.

`pnpm audit:interfaces` derives coverage from the canonical app registry. Every app must have one unclipped shared bar, no exact duplicate navigation actions, working disclosure keyboard controls, and zero mouse-only heading handlers. There are no per-app exceptions. CI also runs mobile and representative data-workflow checks and retains desktop and phone screenshots plus JSON.

## Verification

Release verification includes SynthSR, added to production during this work. The catalog audit passes all 30 desktop and phone cases across the resulting 15 apps with zero legacy heading handlers. Repository and shared-component tests cover the registry, template, shell, native disclosures, and class-driven disclosure state. Mobile checks cover narrow phones, tablets, landscape layouts, navigation, dialogs, and imaging interaction.

Data workflows exercised for this change include:

- `pnpm test:image-uploads` imports a generated four-slice DICOM series through the main scan picker in SynthSR, NiiMath, CALMaR, VesselBoost, SCT, MuscleMap, SeedSeg, QSMbly, Easy MP2RAGE, and MRI2VID. It also checks CALMaR DWI/ADC inputs, QSMbly mask conversion, and Easy MP2RAGE mixed-series rejection. CI runs this suite alongside the interface audit.
- SynthSR's browser suite checks extensionless and `.IMA` DICOM, multiple converted series, return to NIfTI, invalid-input state preservation, cancellation, and retry.

- SynthSR compact input bounds, shared examples, failed-download state preservation, and real `chris_t1` loading at 188 × 256 × 190 voxels. All 19 shared example URLs returned HTTP 200.
- Easy MP2RAGE parameter-family selection, tutorial targets, NIfTI denoising, downloads, and About.
- MRI2VID NIfTI import and the About and Privacy dialogs.
- SCT NIfTI import and threshold preservation across disclosure changes.
- SurfAnnotate surface loading, curvature overlays, ROI filling, and exported labels using cortical fixtures, plus initial panel states using a small OBJ file.
- ZARRo volume loading, measurement, contrast, share links, and large NIfTI export progress and cancellation.
- dicompare keyboard workflow cards and runtime status positioning.
- NiiMath processing and export of a generated 16 × 16 × 16 NIfTI. Every voxel changed from 20 to 40 after `-mul 2`, and the command survived keyboard collapse and reopen.

Deface and BrowserQC passed their unsupported-WebGPU and About workflows in the headless browser. Their GPU processing was not exercised. This review does not validate every scientific pipeline. QSMbly's external ecosystem navigation is stubbed in the local smoke server and is outside this audit.

After a fresh production build, reproduce the screenshots and measurements with `INTERFACE_ARTIFACTS=/tmp/interface-audit pnpm audit:interfaces`. Run `pnpm test:interface-workflows` for the small local-data workflows and `pnpm test:mobile` for layout and touch checks. CI retains the screenshots and measurements as the `interface-audit` artifact.
