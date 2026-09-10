# Repository instructions

## Interface changes and new applications

Before changing UI, adding controls, or scaffolding an app, read [the interface standard](docs/architecture/interface-standard.md). Use QSMbly's compact workflow grouping as the visual reference.

- Keep one shared application bar. Register app-specific About, Cite and Privacy handlers through the shell's control contract. If an app ships a command-line package, register its Standalone instructions through the optional shell control instead of placing them in the workflow sidebar.
- Keep the current task visible. Put optional settings, technical logs and inactive output controls in accessible collapsible sections.
- Place technical logs in a collapsed console below the viewer, following QSMbly's `console-container` disclosure pattern. Keep Copy and Clear actions in the console header.
- Reuse shared layout, spacing and control components. Preserve input values when sections close.
- Before completing UI work, run `pnpm audit:interfaces`, `pnpm test:mobile` and `pnpm test:interface-workflows` against a fresh production build. Review desktop and phone screenshots and exercise the changed workflow. The interface standard defines the review criteria and the audit's limits.

For catalog-wide work, use [the interface audit](docs/architecture/interface-audit.md) to track remaining changes per app. Update its findings when resolving them.

## Hugging Face webapp assets

Store large browser models, templates, atlases, connectomes and fixtures in the public Hugging Face Storage Bucket [`neurodeskorg/webapps-bucket`](https://huggingface.co/buckets/neurodeskorg/webapps-bucket), not in Git. Resolve an object with:

`https://huggingface.co/buckets/neurodeskorg/webapps-bucket/resolve/<snapshot-prefix>/<path>`

The equivalent CLI URI is `hf://buckets/neurodeskorg/webapps-bucket/<snapshot-prefix>/<path>`.

The migration copied every content file from these repositories in the source account `sbollmann`. The source repository's pinned revision is part of the destination path:

| Source repository | Type | Pinned source revision | Destination snapshot prefix | Contents |
| --- | --- | --- | --- | --- |
| `neurodesk-webapps-assets` | dataset | `e0a056b3d6b2b075bab5b780281af17fc9d6421d` | `neurodesk-webapps-assets/e0a056b3d6b2b075bab5b780281af17fc9d6421d/` | `browserqc/`, `deface/`, `musclemap/`, `niimath/`, `seedseg/`, `syncro/`, `synthsr/`, `vesselboost/` |
| `lnm-webapp-models` | dataset | `6fd71cdb20e094c10312b42779abee8375f4142e` | `lnm-webapp-models/6fd71cdb20e094c10312b42779abee8375f4142e/` | CALMaR/LNM `models/`, `templates/`, `atlases/` and `connectomes/` |
| `sct-webapp-data` | dataset | `55c9462a14bc9c84cf093c348cffda9148099df9` | `sct-webapp-data/55c9462a14bc9c84cf093c348cffda9148099df9/` | Spinal Cord Toolbox browser models and fixtures under `web/models/` and `test_data/` |
| `qsm` | dataset | `94bb63332d311b979b606d3d8f1b2cb2e9f389f5` | `qsm/94bb63332d311b979b606d3d8f1b2cb2e9f389f5/` | QSM data under `sub-1/` and `derivatives/`, plus root metadata; no active runtime URL currently uses this snapshot |
| `isles26-nnunet-d507-topk10` | model | `bdc5eccca9a874aef8d042d8daf8088181a644de` | `isles26-nnunet-d507-topk10/bdc5eccca9a874aef8d042d8daf8088181a644de/` | ISLES26 nnU-Net `fold_0/` through `fold_4/`, plans, dataset and export metadata; no active ONNX runtime URL currently uses this snapshot |

Hugging Face Storage Buckets are not versioned. Treat every snapshot prefix as immutable: never overwrite it, never publish an application URL from `main`, and never add a new dependency on the former source account. Publish changed files under a new source-revision or content-addressed prefix, then update the source manifest and regenerate derived artifacts. Keep sharded index filenames relative and resolve them against the pinned index URL.

The scientific manifests in `models/` are the source of truth for asset paths, sizes, hashes, provenance, licences and preprocessing contracts. See [`models/README.md`](models/README.md) for the app-level inventory and [the migration plan](.audit/hf-assets-migration-plan.md) for scope and rationale. The migration tool is `scripts/hf-webapp-assets.mjs`:

- Run `node scripts/hf-webapp-assets.mjs verify` to compare every source and destination path, size and Xet hash.
- Run `node scripts/hf-webapp-assets.mjs verify-content` to anonymously download and byte-compare the non-Xet objects.
- Run `pnpm audit:hf-assets` before committing to reject stale source-account asset references.
- Run `node scripts/hf-webapp-assets.mjs apply` only to recreate the public bucket or restore the five pinned snapshots. The command is additive and does not delete the source repositories.

## Test browser apps through the public reverse proxy

When a user needs an interactive remote preview, use this host's existing HTTPS Caddy site. Prefer a narrow app path over T3 port forwarding or a temporary public tunnel.

1. Build the app's production bundle. For Zarro, run `pnpm --filter zarro build`.
2. Serve the build on loopback. For Zarro, run Vite preview on `127.0.0.1:5173` as the named transient systemd unit `zarro-preview-prototype.service`.
3. Route only `/zarro/*` to `127.0.0.1:5173` in `/etc/caddy/Caddyfile`. Keep the catch-all route pointed at T3 on `127.0.0.1:3773`.
4. Back up the active Caddy file before an edit. Run `sudo caddy validate --config /etc/caddy/Caddyfile` before `sudo systemctl reload caddy`.
5. Verify the public HTTPS app URL, a built asset URL, and the target workflow in the shared browser.

Keep preview servers bound to loopback. Use a different path and port for another app so its preview cannot replace the T3 route or another active preview.
