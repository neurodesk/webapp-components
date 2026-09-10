#!/bin/sh
# Verify an installer package WITHOUT installing it: expand it, check the executable's
# signature, dependencies, absence of build-machine paths, and that it runs offline.
#
#   verify_macos_pkg.sh FILE.pkg
set -eu
pkg=${1:?usage: verify_macos_pkg.sh FILE.pkg}
[ -f "$pkg" ] || { echo "verify_macos_pkg.sh: file not found: $pkg" >&2; exit 2; }
if signature=$(pkgutil --check-signature "$pkg" 2>&1); then
	echo "$signature" | sed 's/^/  /'
else
	case "$signature" in
	*"no signature"*) echo "verify_macos_pkg.sh: WARNING - package is unsigned; local testing only" >&2 ;;
	*) echo "$signature" >&2; echo "verify_macos_pkg.sh: package signature is invalid" >&2; exit 1 ;;
	esac
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/synthseg-verify.XXXXXX")
trap 'rm -rf "$work"' EXIT HUP INT TERM
pkgutil --expand-full "$pkg" "$work/expanded"
exe=$(find "$work/expanded" -type f -path '*/usr/local/bin/synthseg' -print -quit)
[ -n "$exe" ] || { echo "verify_macos_pkg.sh: package does not install /usr/local/bin/synthseg" >&2; exit 1; }
codesign --verify --strict --verbose=2 "$exe"
foreign=$(otool -L "$exe" | tail -n +2 | awk '{ print $1 }' | grep -v '^/usr/lib/' | grep -v '^/System/' || true)
[ -z "$foreign" ] || { echo "verify_macos_pkg.sh: non-system dependencies in $exe:" >&2; echo "$foreign" | sed 's/^/  /' >&2; exit 1; }
if otool -L "$exe" | tail -n +2 | grep -Eq '/opt/homebrew|/usr/local/lib|/target/'; then
	echo "verify_macos_pkg.sh: build-machine library path leaked" >&2; exit 1
fi
chmod +x "$exe"
"$exe" --self-check | sed 's/^/  /'
echo "Verified $pkg"
