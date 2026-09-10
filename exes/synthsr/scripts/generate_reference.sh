#!/bin/sh
# Generate golden outputs from the Node CLI (primary) and FreeSurfer (secondary).
#
#   generate_reference.sh OUTDIR INPUT.nii.gz [--ct]
#
# Writes OUTDIR/<stem>_node.nii.gz, <stem>_fs.nii.gz and appends one JSON line
# per run to OUTDIR/manifest.jsonl. Inputs are never modified.
set -eu
mkdir -p "${1:?usage: generate_reference.sh OUTDIR INPUT.nii.gz [--ct]}"
out=$(cd "$1" && pwd); in=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); ct=${3:-}
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
stem=$(basename "$in" .gz); stem=${stem%.nii}
threads=${SYNTHSR_THREADS:-$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null || nproc)}

run() { # name command...
	name=$1; shift
	start=$(date +%s)
	"$@"
	printf '{"input":"%s","reference":"%s","ct":%s,"threads":%s,"seconds":%s,"sha256":"%s","host":"%s"}\n' \
		"$in" "$out/${stem}_$name.nii.gz" "$([ -n "$ct" ] && echo true || echo false)" "$threads" \
		"$(( $(date +%s) - start ))" "$(shasum -a 256 "$out/${stem}_$name.nii.gz" | cut -d' ' -f1)" \
		"$(uname -m) $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -s)" >> "$out/manifest.jsonl"
}

# ponytail: the model is already downloaded by `make check-model`; pass it explicitly so this stays offline.
run node node "$root/packages/synthsr/bin/synthsr.js" "$in" "$out/${stem}_node.nii.gz" \
	--model "$root/exes/synthsr/models/synthsr-v2.onnx" --threads "$threads" --force --quiet $ct
run fs zsh -ic "fs >/dev/null && mri_synthsr --i '$in' --o '$out/${stem}_fs.nii.gz' --cpu --threads $threads $ct"
