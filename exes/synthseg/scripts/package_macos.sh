#!/bin/sh
# Build a signed macOS installer package for synthseg (from exes/synthsr).
#
#   package_macos.sh <version>
#
# Environment:
#   MACOS_SIGN_IDENTITY       "Developer ID Application: ..." or its SHA-1, or "-" for ad-hoc.
#   MACOS_INSTALLER_IDENTITY  "Developer ID Installer: ..." or its SHA-1 (a different certificate). Unset = unsigned.
#
# The package installs /usr/local/bin/synthseg (model embedded, ONNX Runtime statically linked).
set -eu
set -o pipefail

[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || { echo "package_macos.sh requires Apple Silicon macOS" >&2; exit 2; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=${1:?usage: package_macos.sh VERSION}
identity=${MACOS_SIGN_IDENTITY:--}
installer_identity=${MACOS_INSTALLER_IDENTITY:-}
target=13.4
identifier=org.neurodesk.synthseg
exe="$root/target/release/synthseg"
suffix=
[ "$identity" = - ] && suffix=-adhoc
pkg="$root/dist/synthseg-$version-macos-arm64$suffix.pkg"

case "$version" in *[!A-Za-z0-9._-]*|'') echo "package_macos.sh: bad VERSION" >&2; exit 2;; esac
for tool in codesign pkgbuild productbuild pkgutil otool xattr; do
	command -v "$tool" >/dev/null 2>&1 || { echo "package_macos.sh: missing required tool: $tool" >&2; exit 2; }
done
if [ "$identity" != - ]; then
	security find-identity -v -p codesigning | grep -F -- "$identity" >/dev/null 2>&1 || { echo "package_macos.sh: signing identity not in Keychain: $identity" >&2; exit 2; }
fi
if [ -n "$installer_identity" ]; then
	security find-identity -v | grep -F -- "$installer_identity" >/dev/null 2>&1 || {
		echo "package_macos.sh: installer identity not in Keychain: $installer_identity (needs 'Developer ID Installer')" >&2; exit 2; }
fi
[ -f "$exe" ] || { echo "package_macos.sh: $exe was not built (make build)" >&2; exit 1; }

foreign=$(otool -L "$exe" | tail -n +2 | awk '{ print $1 }' | grep -v '^/usr/lib/' | grep -v '^/System/' || true)
[ -z "$foreign" ] || { echo "package_macos.sh: $exe has non-system dependencies:" >&2; echo "$foreign" | sed 's/^/  /' >&2; exit 1; }
minos=$(otool -l "$exe" | awk '$1 == "minos" { print $2; exit }')
[ "$minos" = "$target" ] || { echo "package_macos.sh: $exe targets macOS $minos, expected $target" >&2; exit 1; }

payload=$(mktemp -d "${TMPDIR:-/tmp}/synthseg-pkg.XXXXXX")
trap 'rm -rf "$payload"' EXIT HUP INT TERM
mkdir -p "$payload/root/usr/local/bin" "$root/dist"
staged="$payload/root/usr/local/bin/synthseg"
cp "$exe" "$staged"; chmod 755 "$staged"; xattr -cr "$staged"
if [ "$identity" = - ]; then
	codesign --force --sign - "$staged"
else
	codesign --force --options runtime --timestamp --sign "$identity" "$staged"
fi
codesign --verify --strict --verbose=2 "$staged"
self_check=$("$staged" --self-check) || {
    status=$?
    printf '%s\n' "$self_check" >&2
    exit "$status"
}
printf '%s\n' "$self_check" | sed 's/^/  /'

pkgbuild --root "$payload/root" --identifier "$identifier" --version "$version" --install-location / "$payload/component.pkg"
if [ -n "$installer_identity" ]; then
	productbuild --package "$payload/component.pkg" --sign "$installer_identity" "$pkg"
else
	echo "package_macos.sh: MACOS_INSTALLER_IDENTITY unset; package is unsigned (local testing only)" >&2
	productbuild --package "$payload/component.pkg" "$pkg"
fi
echo "package_macos.sh: wrote $pkg"
pkgutil --check-signature "$pkg" 2>&1 | sed 's/^/  /' || true
shasum -a 256 "$exe" "$pkg"
