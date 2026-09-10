#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(dirname "$script_dir")"
env_dir="${MUSCLEMAP_CONVERSION_ENV:-$app_dir/.tmp_model_env}"
python_version="3.11.16"

if command -v uv >/dev/null 2>&1; then
  uv venv --python "$python_version" "$env_dir"
  uv pip install --python "$env_dir/bin/python" \
    --index-url https://download.pytorch.org/whl/cpu \
    torch==2.4.1
  uv pip install --python "$env_dir/bin/python" \
    --requirement "$script_dir/requirements-conversion.txt"
else
  python3.11 -m venv "$env_dir"
  "$env_dir/bin/pip" install \
    --index-url https://download.pytorch.org/whl/cpu \
    torch==2.4.1
  "$env_dir/bin/pip" install \
    --requirement "$script_dir/requirements-conversion.txt"
fi

actual_python_version="$("$env_dir/bin/python" -c 'import platform; print(platform.python_version())')"
if [[ "$actual_python_version" != "$python_version" ]]; then
  echo "Expected Python $python_version, found $actual_python_version" >&2
  exit 1
fi

"$env_dir/bin/python" -c \
  'import huggingface_hub, monai, onnx, onnxruntime, torch; from huggingface_hub import HfApi; assert hasattr(HfApi, "batch_bucket_files"); print(f"torch={torch.__version__} monai={monai.__version__} onnx={onnx.__version__} onnxruntime={onnxruntime.__version__} huggingface_hub={huggingface_hub.__version__}")'
