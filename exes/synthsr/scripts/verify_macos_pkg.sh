#!/bin/sh
# Verify an installer package WITHOUT installing it: expand it, check the executable's
# signature, dependencies, absence of build-machine paths, and that it runs offline.
#
#   verify_macos_pkg.sh FILE.pkg
set -eu
pkg=${1:?usage: verify_macos_pkg.sh FILE.pkg}
[ -f "$pkg" ] || { echo "verify_macos_pkg.sh: file not found: $pkg" >&2; exit 2; }
allow_adhoc=false
case "${2:-}" in
    --allow-adhoc) allow_adhoc=true ;;
    '') ;;
    *) echo "Unknown option: $2" >&2; exit 2 ;;
esac
if [ "$allow_adhoc" = false ]; then
    team=${EXPECTED_TEAM_ID:?set EXPECTED_TEAM_ID for signed verification, or use --allow-adhoc for a trusted local test build}
    case "$team" in *[!A-Z0-9]*|'') echo "Invalid EXPECTED_TEAM_ID" >&2; exit 2 ;; esac
    [ "${#team}" -eq 10 ] || { echo "Invalid EXPECTED_TEAM_ID" >&2; exit 2; }
fi
signature=$(pkgutil --check-signature "$pkg" 2>&1) || {
    if [ "$allow_adhoc" != true ] || ! printf '%s' "$signature" | grep -q 'no signature'; then
        printf '%s\n' "$signature" >&2; exit 1
    fi
}
printf '%s\n' "$signature"
if [ "$allow_adhoc" = false ]; then
    printf '%s\n' "$signature" | grep -q 'Status: signed by a developer certificate' || exit 1
    printf '%s\n' "$signature" | grep -Eq "Developer ID Installer: .*\($team\)" || {
        echo "Unexpected package signing team" >&2; exit 1;
    }
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/synthsr-verify.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
pkgutil --expand-full "$pkg" "$work/expanded"
exe=$(find "$work/expanded" -type f -path '*/usr/local/bin/synthsr' -print -quit)
[ -n "$exe" ] || { echo "verify_macos_pkg.sh: package does not install /usr/local/bin/synthsr" >&2; exit 1; }
dawn=$(find "$work/expanded" -type f -path '*/usr/local/lib/synthsr/libwebgpu_dawn.dylib' -print -quit)
[ -n "$dawn" ] || { echo "verify_macos_pkg.sh: package does not install libwebgpu_dawn.dylib" >&2; exit 1; }
for bin in "$dawn" "$exe"; do
	codesign --verify --strict --verbose=2 "$bin"
    if [ "$allow_adhoc" = false ]; then
        identity=$(codesign -dv --verbose=4 "$bin" 2>&1)
        printf '%s\n' "$identity" | grep -Fx "TeamIdentifier=$team" >/dev/null || {
            echo "Unexpected binary signing team" >&2; exit 1;
        }
        printf '%s\n' "$identity" | grep -q '^Authority=Developer ID Application:' || exit 1
    fi
    commands=$(otool -l "$bin")
    rpaths=$(printf '%s\n' "$commands" | awk '$1 == "cmd" { rpath = ($2 == "LC_RPATH") } rpath && $1 == "path" { print $2 }')
    if printf '%s\n' "$rpaths" | grep -q '^/'; then
        echo "Absolute build-host RPATH in $bin" >&2; exit 1
    fi
    if [ "$bin" = "$exe" ]; then
        printf '%s\n' "$rpaths" | grep -Fx '@executable_path/../lib/synthsr' >/dev/null || {
            echo "Missing packaged runtime RPATH" >&2; exit 1;
        }
    fi
	foreign=$(otool -L "$bin" | tail -n +2 | awk '{ print $1 }' | grep -v '^/usr/lib/' | grep -v '^/System/' | grep -v '^@rpath/libwebgpu_dawn.dylib$' || true)
	[ -z "$foreign" ] || { echo "verify_macos_pkg.sh: non-system dependencies in $bin:" >&2; echo "$foreign" | sed 's/^/  /' >&2; exit 1; }
	if otool -L "$bin" | tail -n +2 | grep -Eq '/opt/homebrew|/usr/local/lib|/target/'; then
		echo "verify_macos_pkg.sh: build-machine library path leaked" >&2; exit 1
	fi
done
chmod +x "$exe"
# Runs from the expanded payload: @executable_path/../lib/synthsr resolves inside it.
self_check=$("$exe" --self-check) || {
	status=$?
	printf '%s\n' "$self_check" >&2
	exit "$status"
}
printf '%s\n' "$self_check" | sed 's/^/  /'
echo "Verified $pkg"
