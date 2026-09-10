#!/usr/bin/env python3
"""Fetch the pinned SynthSR model and verify it before a native build."""

import hashlib
import json
from pathlib import Path
import shutil
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT.parent.parent / "packages/synthsr/model.manifest.json"


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    asset = manifest["assets"][0]
    destination = ROOT / "models" / asset["filename"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and digest(destination) == asset["sha256"]:
        print(f"{destination}: OK")
        return
    partial = destination.with_name(destination.name + ".partial")
    try:
        for attempt in range(3):
            try:
                with urllib.request.urlopen(manifest["base_url"] + asset["filename"]) as response:
                    with partial.open("wb") as output:
                        shutil.copyfileobj(response, output)
                break
            except OSError:
                partial.unlink(missing_ok=True)
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
        if partial.stat().st_size != asset["bytes"] or digest(partial) != asset["sha256"]:
            raise ValueError("downloaded model does not match the pinned size and SHA-256")
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)
    print(f"{destination}: OK")


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


if __name__ == "__main__":
    main()
