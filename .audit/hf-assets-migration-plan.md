# Hugging Face webapp asset migration

## Definition of done

The migration is complete when all content objects from the five webapp-related repositories owned by `sbollmann` have byte-identical copies under the public `neurodeskorg/webapps-bucket` Storage Bucket, every active webapp reference uses the bucket URL, the repository's artifact and interface checks pass, and runtime HTTP checks confirm the new objects are publicly readable. Repository-only `.gitattributes` files are outside the content inventory because Hugging Face excludes them from repository-to-bucket copies.

## Scope

- `sbollmann/neurodesk-webapps-assets`, 43 files and 787,751,896 bytes.
- `sbollmann/lnm-webapp-models`, 26 files and 559,304,258 bytes.
- `sbollmann/sct-webapp-data`, 25 files and 1,036,874,418 bytes.
- `sbollmann/qsm`, 27 data or metadata files and 606,561,088 bytes. The current checkout has no direct URL to this dataset, but it is included because it contains QSM webapp data.
- `sbollmann/isles26-nnunet-d507-topk10`, 11 model or metadata files and 624,341,112 bytes. The current checkout has no direct runtime URL to this model, but it is included because it is a webapp model asset owned by the source account.

## Workflow

- [x] Read the Poteto mode Principles section in full.
- [x] Phase A, frame the checkable result, scope, risks, and rigor level.
- [x] Phase B, inventory source snapshots, active URLs, manifests, generated files, and verification commands.
- [x] Phase B, build a rerunnable migration and verification script before changing consumers.
- [x] Phase C, create the public destination bucket without deleting source data.
- [x] Phase C, copy one source unit at a time and verify its remote inventory before continuing.
- [x] Phase C, rewrite source manifests first, regenerate derived files, and verify each app group.
- [x] Phase D, append decisions and verified checkpoints to `.audit/hf-assets-migration.tsv` throughout the run.
- [x] Phase E, run repository audits, builds, app tests, public HTTP checks, and content-hash samples.
- [x] Phase E, audit the decision trail and get an independent review before handoff.

## Rigor

High. The source repositories are public production dependencies and the destination bucket is non-versioned. Source snapshot IDs are encoded into destination prefixes so app URLs keep a stable content identity. Copies are additive and rerunnable. No source repository is deleted in this run.
