# Repository instructions

This repository stores source code only. Large validation datasets and models belong on [https://huggingface.co/datasets/neurodeskorg/webapps](https://huggingface.co/datasets/neurodeskorg/webapps). Version patch numbers typically use the release date as `YYYYMMDD` (e.g., `0.1.20260808`).

## Interface changes and new applications

Before changing UI, adding controls, or scaffolding an app, read [the interface standard](docs/architecture/interface-standard.md). Use QSMbly's compact workflow grouping as the visual reference.

- Keep one shared application bar. Register app-specific About, Cite and Privacy handlers through the shell's control contract. If an app ships a command-line package, register its Standalone instructions through the optional shell control instead of placing them in the workflow sidebar.
- Keep the current task visible. Put optional settings, technical logs and inactive output controls in accessible collapsible sections.
- Place technical logs in a collapsed console below the viewer, following QSMbly's `console-container` disclosure pattern. Keep Copy and Clear actions in the console header.
- Reuse shared layout, spacing and control components. Preserve input values when sections close.
- Before completing UI work, run `pnpm audit:interfaces`, `pnpm test:mobile` and `pnpm test:interface-workflows` against a fresh production build. Review desktop and phone screenshots and exercise the changed workflow. The interface standard defines the review criteria and the audit's limits.

For catalog-wide work, use [the interface audit](docs/architecture/interface-audit.md) to track remaining changes per app. Update its findings when resolving them.

## Test browser apps through the public reverse proxy

When a user needs an interactive remote preview, use this host's existing HTTPS Caddy site. Prefer a narrow app path over T3 port forwarding or a temporary public tunnel.

1. Build the app's production bundle. For Zarro, run `pnpm --filter zarro build`.
2. Serve the build on loopback. For Zarro, run Vite preview on `127.0.0.1:5173` as the named transient systemd unit `zarro-preview-prototype.service`.
3. Route only `/zarro/*` to `127.0.0.1:5173` in `/etc/caddy/Caddyfile`. Keep the catch-all route pointed at T3 on `127.0.0.1:3773`.
4. Back up the active Caddy file before an edit. Run `sudo caddy validate --config /etc/caddy/Caddyfile` before `sudo systemctl reload caddy`.
5. Verify the public HTTPS app URL, a built asset URL, and the target workflow in the shared browser.

Keep preview servers bound to loopback. Use a different path and port for another app so its preview cannot replace the T3 route or another active preview.

## Native executables (exes/)

`exes/<app>` holds native Rust executables, not pnpm packages. `exes/synthsr`
builds with `make` inside that directory (`check-model`, `build`, `test`,
`test-real`, `macos-release`), not `pnpm`. Model assets come from the Hugging
Face dataset `neurodeskorg/webapps` via a pinned manifest and are never
committed.

`exes/synthsr/src/nifti.rs` and `src/volume.rs` are line-for-line ports of
`packages/synthsr/src/volume.js` and must stay bit-identical (f64 math, f32
storage): change the JS and the Rust together. `exes/synthsr/src/metal.rs`
mirrors `packages/synthsr/src/gpu-conv3d.js` and `gpu-session.js` the same
way.
