# SynthSR native releases

## Problem

SynthSR has a signed Apple Silicon installer, but its native Linux and Windows builds are not packaged or published. The executable embeds the model and statically links ONNX Runtime. Its WebGPU provider still needs the platform-specific Dawn library at process startup. Each portable archive must contain that library and must run after extraction.

The webapp has a Standalone dialog for the separate Node.js package. Native archives are too large for the web bundle, so the dialog must link to GitHub release assets instead.

## Usage

One manual `synthsr-native` workflow run builds Linux x64 and Windows x64 archives, signs and notarizes the existing macOS Apple Silicon installer, verifies each package, and uploads all assets to `synthsr-vVERSION`.

The Standalone dialog gives each operating system a direct download and its shortest working command. Linux and Windows users extract an archive and run the executable from that directory. macOS users open the installer and run `synthsr` from a terminal. The native packages work offline because the model is embedded.

## Shape

`exes/synthsr/Cargo.toml` remains the native version source. A small Vite plugin reads that version and injects it into the app build. `nativeDownloads(version)` derives the release tag, filenames, URLs, and commands. The HTML owns the visible platform sections, and `main.js` fills their links and command text.

`portable_release.py` owns the Linux and Windows archive layouts. It copies the executable, the matching Dawn library, and the project notices into a flat archive. It dereferences Cargo's library symlinks. Its verification command checks the archive checksum and exact contents, extracts into a fresh path, runs `--self-check`, and processes the small validation scan with the packaged executable.

Linux adds `RUNPATH=$ORIGIN`, so its loader finds `libwebgpu_dawn.so` beside `synthsr`. Windows already searches beside `synthsr.exe` for `webgpu_dawn.dll`.

The GitHub Actions workflow keeps platform builds separate. Only the final macOS release job has release-write permission. It waits for both portable jobs, downloads their verified workflow artifacts, runs the existing signing and notarization path, and uploads all three platforms in one command. A tag-specific concurrency group prevents two native release runs from writing the same release at once.

## Synthesis decision

The base design used one coordinated publisher, extracted-package checks, Cargo-derived names, and GitHub-only native assets. The implementation keeps those parts. It uses explicit platform jobs and one small portable script instead of adding a target registry, release-plan schema, internal archive manifest, or virtual module.

## Tradeoffs accepted

- Linux and Windows archives are checksum-verified but unsigned. macOS keeps Developer ID signing and Apple notarization.
- Linux uses a fixed GitHub-hosted Ubuntu runner. This gives the release a glibc dependency, which the portable archive does not remove.
- The existing Node.js package stays in the web bundle for Node and HPC users. Native archives stay on GitHub Releases.
- GitHub release uploads are not transactional. Requiring a draft or prerelease keeps a partial upload out of a normal published release.

## Alternatives considered

Independent release workflows would make operators coordinate three writers and could leave a release with mismatched platforms. Embedding native archives in the webapp would exceed its artifact budget. A general target manifest and generated release-plan format would remove a few repeated strings, but it would add more policy than three fixed targets need.

## Open risks

The first Windows Actions run must prove the exact Dawn DLL name and any system runtime requirements. Do not name a minimum Linux distribution until a release artifact inspection establishes its glibc requirement.

## Next implementation step

Add failing archive and download-catalog tests, then implement the portable packager, the coordinated workflow, and the Standalone dialog against those contracts.
