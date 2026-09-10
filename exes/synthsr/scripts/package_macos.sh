#!/bin/sh
# Build a signed macOS installer package for synthsr.
#
#   package_macos.sh <version>
#
# Environment:
#   MACOS_SIGN_IDENTITY       "Developer ID Application: ..." or its SHA-1, or "-" for ad-hoc.
#   MACOS_INSTALLER_IDENTITY  "Developer ID Installer: ..." or its SHA-1. A DIFFERENT certificate;
#                             a package signed with the Application one is rejected. Unset = unsigned.
#
# The package installs /usr/local/bin/synthsr (model embedded, ONNX Runtime statically
# linked) and /usr/local/lib/synthsr/libwebgpu_dawn.dylib, the Dawn WebGPU-on-Metal
# runtime that ORT's WebGPU provider loads via @rpath.
set -eu

[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || { echo "package_macos.sh requires Apple Silicon macOS" >&2; exit 2; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=${1:?usage: package_macos.sh VERSION}
identity=${MACOS_SIGN_IDENTITY:--}
installer_identity=${MACOS_INSTALLER_IDENTITY:-}
target=13.4
identifier=org.neurodesk.synthsr
exe="$root/target/release/synthsr"
dawn="$root/target/release/libwebgpu_dawn.dylib"
# Ad-hoc builds get their own name so an unsigned package can never be mistaken for a release.
suffix=
[ "$identity" = - ] && suffix=-adhoc
pkg="$root/dist/synthsr-$version-macos-arm64$suffix.pkg"

case "$version" in *[!A-Za-z0-9._-]*|'') echo "package_macos.sh: bad VERSION" >&2; exit 2;; esac
for tool in codesign pkgbuild productbuild pkgutil otool xattr; do
	command -v "$tool" >/dev/null 2>&1 || { echo "package_macos.sh: missing required tool: $tool" >&2; exit 2; }
done
if [ "$identity" != - ]; then
	security find-identity -v -p codesigning | grep -F -- "$identity" >/dev/null 2>&1 || { echo "package_macos.sh: signing identity not in Keychain: $identity" >&2; exit 2; }
fi
# Installer certificates are not codesigning identities, so they are absent from -p codesigning.
if [ -n "$installer_identity" ]; then
	security find-identity -v | grep -F -- "$installer_identity" >/dev/null 2>&1 || {
		echo "package_macos.sh: installer identity not in Keychain: $installer_identity (needs 'Developer ID Installer')" >&2; exit 2; }
fi
[ -f "$exe" ] && [ -f "$dawn" ] || { echo "package_macos.sh: $exe or $dawn was not built (make build)" >&2; exit 1; }

# Only system libraries plus the Dawn dylib we ship ourselves.
for bin in "$exe" "$dawn"; do
	foreign=$(otool -L "$bin" | tail -n +2 | awk '{ print $1 }' | grep -v '^/usr/lib/' | grep -v '^/System/' | grep -v '^@rpath/libwebgpu_dawn.dylib$' || true)
	[ -z "$foreign" ] || { echo "package_macos.sh: $bin has non-system dependencies:" >&2; echo "$foreign" | sed 's/^/  /' >&2; exit 1; }
	minos=$(otool -l "$bin" | awk '$1 == "minos" { print $2; exit }')
	[ "$minos" = "$target" ] || { echo "package_macos.sh: $bin targets macOS $minos, expected $target" >&2; exit 1; }
done

payload=$(mktemp -d "${TMPDIR:-/tmp}/synthsr-pkg.XXXXXX")
trap 'rm -rf "$payload"' EXIT HUP INT TERM
mkdir -p "$payload/root/usr/local/bin" "$payload/root/usr/local/lib/synthsr" "$root/dist"
staged="$payload/root/usr/local/bin/synthsr"
staged_dawn="$payload/root/usr/local/lib/synthsr/libwebgpu_dawn.dylib"
cp "$exe" "$staged"; cp "$dawn" "$staged_dawn"
chmod 755 "$staged" "$staged_dawn"; xattr -cr "$staged" "$staged_dawn"
# Sign inside-out: the dylib first, then the executable. Hardened runtime and a
# secure timestamp are both required for notarization.
for bin in "$staged_dawn" "$staged"; do
	if [ "$identity" = - ]; then
		codesign --force --sign - "$bin"
	else
		codesign --force --options runtime --timestamp --sign "$identity" "$bin"
	fi
	codesign --verify --strict --verbose=2 "$bin"
done
"$staged" --self-check >/dev/null

pkgbuild --root "$payload/root" --identifier "$identifier" --version "$version" --install-location / "$payload/component.pkg"
if [ -n "$installer_identity" ]; then
	productbuild --package "$payload/component.pkg" --sign "$installer_identity" "$pkg"
else
	echo "package_macos.sh: MACOS_INSTALLER_IDENTITY unset; package is unsigned (local testing only)" >&2
	productbuild --package "$payload/component.pkg" "$pkg"
fi
echo "package_macos.sh: wrote $pkg"
pkgutil --check-signature "$pkg" 2>&1 | sed 's/^/  /' || true
shasum -a 256 "$exe" "$dawn" "$pkg"
