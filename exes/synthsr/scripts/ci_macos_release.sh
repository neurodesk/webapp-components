#!/bin/bash
set -euo pipefail

for name in APPLEID APPLEIDPASS APPLE_TEAM_ID CSC_LINK CSC_KEY_PASSWORD CSC_INSTALLER_LINK CSC_INSTALLER_KEY_PASSWORD; do
    if [[ -z "${!name:-}" ]]; then
        echo "Missing signing secret: $name" >&2
        exit 2
    fi
done

root=$(cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/synthsr-signing.XXXXXX")
keychain="$work/signing.keychain-db"
original_keychain=$(security default-keychain -d user | tr -d '"' | sed 's/^ *//')
cleanup() {
    security default-keychain -d user -s "$original_keychain" >/dev/null 2>&1 || true
    security delete-keychain "$keychain" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT

# CSC_LINK uses the same base64 PKCS#12 format as neurodesk-app.
printf '%s' "$CSC_LINK" | base64 --decode > "$work/application.p12"
printf '%s' "$CSC_INSTALLER_LINK" | base64 --decode > "$work/installer.p12"
password=$(openssl rand -hex 24)
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security list-keychains -d user -s "$keychain" "$original_keychain"
security default-keychain -d user -s "$keychain"
security import "$work/application.p12" -k "$keychain" -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign
security import "$work/installer.p12" -k "$keychain" -P "$CSC_INSTALLER_KEY_PASSWORD" -T /usr/bin/productsign -T /usr/bin/productbuild
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null

xcrun notarytool store-credentials synthsr-ci --keychain "$keychain" \
    --apple-id "$APPLEID" --password "$APPLEIDPASS" --team-id "$APPLE_TEAM_ID"
# The temporary keychain is the sole user search keychain, so Make selects its identities.
EXPECTED_TEAM_ID="$APPLE_TEAM_ID" make -C "$root" macos-release NOTARY_PROFILE=synthsr-ci
