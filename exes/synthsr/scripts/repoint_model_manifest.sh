#!/bin/sh
# After uploading the staged assets to neurodeskorg/webapps, pin both synthsr
# manifests to that commit:  repoint_model_manifest.sh <commit-sha>
set -eu
rev=${1:?usage: repoint_model_manifest.sh COMMIT_SHA}
case "$rev" in
    *[!0-9a-fA-F]*|'') echo "Revision must be a full 40-character hexadecimal commit ID" >&2; exit 2 ;;
esac
[ "${#rev}" -eq 40 ] || { echo "Revision must be a full 40-character hexadecimal commit ID" >&2; exit 2; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
for f in "$root/packages/synthsr/model.manifest.json" "$root/models/synthsr.manifest.json"; do
	python3 - "$f" "$rev" <<'PY'
import json, sys
path, rev = sys.argv[1], sys.argv[2]
m = json.load(open(path))
m["repository"] = "neurodeskorg/webapps"
m["revision"] = rev
m["base_url"] = f"https://huggingface.co/datasets/neurodeskorg/webapps/resolve/{rev}/synthsr/models/"
json.dump(m, open(path, "w"), indent=2); open(path, "a").write("\n")
PY
done
cd "$root/exes/synthsr" && rm -f models/synthsr-v2.onnx && make check-model
