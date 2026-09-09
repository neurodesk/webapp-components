# synthsr: build, test and package the native SynthSR executable.
# `make help` lists targets. Release signing needs two Developer ID identities;
# notarization credentials live only in Keychain (make macos-notary-profile).
VERSION ?= $(shell sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml)
# Default to the Developer ID certificates in the Keychain (first match of each kind).
MACOS_SIGN_IDENTITY ?= $(shell security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)
MACOS_INSTALLER_IDENTITY ?= $(shell security find-identity -v | sed -n 's/.*"\(Developer ID Installer: [^"]*\)".*/\1/p' | head -1)
NOTARY_PROFILE ?= synthsr-notary
SYNTHSR_REFERENCE_DIR ?= $(HOME)/src/synthsr-references
MANIFEST = ../../packages/synthsr/model.manifest.json
MODEL = models/synthsr-v2.onnx
BIN = target/release/synthsr
MACOS_PKG = dist/synthsr-$(VERSION)-macos-arm64.pkg

.PHONY: help check-model fmt lint test test-release-scripts test-real build clean \
	macos-pkg-adhoc macos-pkg macos-notary-profile check-notary-profile macos-notarize macos-release

help:
	@echo "check-model            download (if missing) and verify the pinned ONNX model"
	@echo "build                  release build -> $(BIN)"
	@echo "test                   fixture parity, CLI behavior, self-check"
	@echo "test-real              benchmark volumes vs goldens in SYNTHSR_REFERENCE_DIR"
	@echo "fmt / lint             cargo fmt --check / cargo clippy"
	@echo "macos-pkg-adhoc        unsigned dist/*-adhoc.pkg for local testing"
	@echo "macos-pkg              signed .pkg (MACOS_SIGN_IDENTITY, MACOS_INSTALLER_IDENTITY)"
	@echo "macos-notary-profile   store notarytool credentials (APPLE_ID, TEAM_ID)"
	@echo "macos-notarize         notarize + staple + validate $(MACOS_PKG)"
	@echo "macos-release          check-notary-profile, macos-pkg, macos-notarize"

# ponytail: the URL is revision-pinned on Hugging Face, so a fetch is reproducible; build.rs re-verifies.
check-model: $(MODEL)
	@printf '%s  %s\n' "$$(python3 -c 'import json;print(json.load(open("$(MANIFEST)"))["assets"][0]["sha256"])')" "$(MODEL)" | shasum -a 256 -c
$(MODEL):
	mkdir -p models
	curl -fL --retry 3 -o "$@.partial" "$$(python3 -c 'import json;m=json.load(open("$(MANIFEST)"));print(m["base_url"]+m["assets"][0]["filename"])')"
	mv "$@.partial" "$@"

build: check-model
	cargo build --release
	@echo "built $(BIN)"

fmt:
	cargo fmt --check

lint: check-model
	cargo clippy --release --all-targets -- -D warnings

test: check-model test-release-scripts
	cargo test --release

test-release-scripts:
	python3 scripts/test_release_scripts.py

test-real: check-model
	@test -f "$(SYNTHSR_REFERENCE_DIR)/manifest.jsonl" || { \
		echo "No goldens in $(SYNTHSR_REFERENCE_DIR). Generate with scripts/generate_reference.sh." >&2; exit 2; }
	SYNTHSR_REFERENCE_DIR="$(SYNTHSR_REFERENCE_DIR)" cargo test --release -- --ignored real_volumes
	@echo "report: $(SYNTHSR_REFERENCE_DIR)/report.json"

clean:
	cargo clean
	rm -rf dist

macos-pkg-adhoc: build
	env MACOS_SIGN_IDENTITY=- MACOS_INSTALLER_IDENTITY= scripts/package_macos.sh "$(VERSION)"

macos-pkg: build
	@test -n "$(MACOS_SIGN_IDENTITY)" || { echo "Set MACOS_SIGN_IDENTITY to a Developer ID Application identity or SHA-1." >&2; exit 2; }
	@test -n "$(MACOS_INSTALLER_IDENTITY)" || { echo "Set MACOS_INSTALLER_IDENTITY to a Developer ID Installer identity or SHA-1 (security find-identity -v)." >&2; exit 2; }
	env MACOS_SIGN_IDENTITY="$(MACOS_SIGN_IDENTITY)" MACOS_INSTALLER_IDENTITY="$(MACOS_INSTALLER_IDENTITY)" \
		scripts/package_macos.sh "$(VERSION)"

macos-notarize:
	scripts/notarize_macos.sh "$(MACOS_PKG)" "$(NOTARY_PROFILE)"

macos-notary-profile:
	@test -n "$(APPLE_ID)" || { echo "Set APPLE_ID to your Developer Apple ID." >&2; exit 2; }
	@test -n "$(TEAM_ID)" || { echo "Set TEAM_ID to your 10-character Developer Team ID." >&2; exit 2; }
	scripts/store_notary_credentials.sh "$(NOTARY_PROFILE)" "$(APPLE_ID)" "$(TEAM_ID)"

# Credentials are checked first so a missing profile fails before the build, not after it.
macos-release:
	+$(MAKE) check-notary-profile
	+$(MAKE) test
	+$(MAKE) macos-pkg
	+$(MAKE) macos-notarize

check-notary-profile:
	@xcrun notarytool history --keychain-profile "$(NOTARY_PROFILE)" >/dev/null 2>&1 || { \
		echo "No notarization credentials for profile '$(NOTARY_PROFILE)'. Store them once with:" >&2; \
		echo "  make macos-notary-profile APPLE_ID='you@example.com' TEAM_ID='ABCDE12345'" >&2; \
		echo "(prompts for an app-specific password from appleid.apple.com, not your Apple ID password)" >&2; \
		exit 2; }
	@echo "notarization credentials found for profile '$(NOTARY_PROFILE)'"
