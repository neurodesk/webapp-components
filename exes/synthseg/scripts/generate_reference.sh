#!/bin/sh
# Generate golden outputs from FreeSurfer's mri_synthseg (SynthSeg 2.0).
#
#   generate_reference.sh OUTDIR INPUT.nii.gz [--ct]
#
# Writes OUTDIR/<stem>_fast.nii.gz and <stem>_default.nii.gz and prints one JSON line per run.
set -eu
out=$(mkdir -p "$1" && cd "$1" && pwd); in=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); ct=${3:-}
stem=$(basename "$in" .gz); stem=${stem%.nii}
threads=${SYNTHSEG_THREADS:-$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null || nproc)}
fs_home=${FREESURFER_HOME:-/Applications/freesurfer/8.1.0}

run() { # name flags...
	name=$1; shift
	seg="$out/${stem}_$name.nii.gz"
	start=$(date +%s)
	( export FREESURFER_HOME="$fs_home"; . "$fs_home/SetUpFreeSurfer.sh" >/dev/null
	  mri_synthseg --i "$in" --o "$seg" --threads "$threads" --cpu $ct "$@" )
	printf '{"input":"%s","mode":"%s","reference":"%s","ct":%s,"threads":%s,"seconds":%s,"sha256":"%s","freesurfer":"%s"}\n' \
		"$in" "$name" "$seg" "$([ -n "$ct" ] && echo true || echo false)" "$threads" \
		"$(( $(date +%s) - start ))" "$(shasum -a 256 "$seg" | cut -d' ' -f1)" "$(cat "$fs_home/build-stamp.txt" 2>/dev/null || basename "$fs_home")"
}

run fast --fast
run default
