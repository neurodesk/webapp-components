#!/usr/bin/env python3

import argparse
import json
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
DEFAULT_STAGE = APP_DIR / ".tmp_model_release" / "wholebody-v1.4"


def parse_args():
    parser = argparse.ArgumentParser(description="Activate a published, validated MuscleMap release")
    parser.add_argument("--release", type=Path, default=APP_DIR / "model-sources" / "release.json")
    parser.add_argument("--package", type=Path, default=APP_DIR / "package.json")
    parser.add_argument("--conversion-report", type=Path, default=DEFAULT_STAGE / "conversion-report.json")
    parser.add_argument("--fidelity-report", type=Path, default=DEFAULT_STAGE / "fidelity-report.json")
    parser.add_argument("--browser-report", type=Path, default=DEFAULT_STAGE / "browser-report.json")
    parser.add_argument("--upstream-report", type=Path, default=DEFAULT_STAGE / "upstream-parity-report.json")
    parser.add_argument("--receipt", type=Path, default=DEFAULT_STAGE / "publication-receipt.json")
    return parser.parse_args()


def main():
    args = parse_args()
    release = json.loads(args.release.read_text())
    package = json.loads(args.package.read_text())
    conversion = json.loads(args.conversion_report.read_text())
    fidelity = json.loads(args.fidelity_report.read_text())
    browser_report = json.loads(args.browser_report.read_text())
    upstream_report = json.loads(args.upstream_report.read_text())
    receipt = json.loads(args.receipt.read_text())

    if conversion.get("status") != "structural-and-random-patch-passed":
        raise ValueError("Conversion report did not pass")
    if fidelity.get("status") != "passed":
        raise ValueError("Fidelity report did not pass")
    if browser_report.get("status") != "passed":
        raise ValueError("Browser report did not pass")
    if upstream_report.get("status") != "passed":
        raise ValueError("Full-volume upstream parity report did not pass")
    if receipt.get("status") != "published-and-anonymously-verified":
        raise ValueError("Publication receipt was not anonymously verified")
    candidate = fidelity["candidate"]
    conversion_candidate = next(
        (item for item in conversion["candidates"] if item["precision"] == candidate["precision"]),
        None,
    )
    if not conversion_candidate or any(
        conversion_candidate[field] != candidate[field] for field in ("path", "bytes", "sha256")
    ):
        raise ValueError("Fidelity candidate does not match the conversion report")
    if receipt.get("candidate") != candidate:
        raise ValueError("Publication receipt does not match the fidelity candidate")
    if browser_report.get("candidate") != candidate:
        raise ValueError("Browser report does not match the fidelity candidate")
    if upstream_report.get("candidate") != candidate:
        raise ValueError("Upstream parity report does not match the fidelity candidate")
    if not isinstance(receipt.get("bucket"), str) or not isinstance(receipt.get("prefix"), str):
        raise ValueError("Publication receipt lacks an immutable bucket prefix")
    expected_prefix = f"neurodesk-webapps-assets/{candidate['sha256']}/musclemap"
    if receipt["prefix"] != expected_prefix:
        raise ValueError(f"Publication receipt prefix must equal {expected_prefix}")

    already_active = [
        model for model in release["models"]
        if model["id"] == "wholebody" and model["status"] == "active" and
        model["labelSpaceId"] == "musclemap-wholebody-v1.4"
    ]
    if already_active:
        expected_asset = {
            "revision": candidate["sha256"][:40],
            "bytes": candidate["bytes"],
            "sha256": candidate["sha256"],
            "precision": candidate["precision"],
            "validationReport": receipt["provenancePath"],
        }
        if (
            len(already_active) != 1 or already_active[0].get("asset") != expected_asset or
            release.get("publication", {}).get("bucket") != receipt["bucket"] or
            release.get("publication", {}).get("prefix") != receipt["prefix"] or
            release.get("appVersion") != release.get("targetAppVersion") or
            package.get("version") != release.get("targetAppVersion")
        ):
            raise ValueError("The existing v1.4 activation does not match the publication receipt")
        subprocess.run(["node", str(SCRIPT_DIR / "generate_model_contracts.mjs"), "--check"], check=True)
        print(f"MuscleMap v{release['targetAppVersion']} is already active at {receipt['prefix']}")
        return

    staged = [
        model for model in release["models"]
        if model["id"] == "wholebody" and model["status"] == "staged"
    ]
    if len(staged) != 1:
        raise ValueError("Expected exactly one staged whole-body release")
    for model in release["models"]:
        if model["id"] == "wholebody" and model["status"] == "active":
            if model.get("asset") and not model["asset"].get("url"):
                model["asset"]["url"] = f"{release['publication']['baseUrl']}/{model['filename']}"
            model["status"] = "retired"
    staged_model = staged[0]
    staged_model["status"] = "active"
    staged_model["asset"] = {
        "revision": candidate["sha256"][:40],
        "bytes": candidate["bytes"],
        "sha256": candidate["sha256"],
        "precision": candidate["precision"],
        "validationReport": receipt["provenancePath"],
    }

    target_version = release["targetAppVersion"]
    release["appVersion"] = target_version
    release["publication"] = {
        "bucket": receipt["bucket"],
        "prefix": receipt["prefix"],
        "baseUrl": f"https://huggingface.co/buckets/{receipt['bucket']}/resolve/{receipt['prefix']}",
    }
    package["version"] = target_version

    release_temporary = args.release.with_suffix(".json.next")
    package_temporary = args.package.with_suffix(".json.next")
    release_temporary.write_text(json.dumps(release, indent=2) + "\n")
    package_temporary.write_text(json.dumps(package, indent=2) + "\n")
    release_temporary.replace(args.release)
    package_temporary.replace(args.package)
    subprocess.run(["node", str(SCRIPT_DIR / "generate_model_contracts.mjs")], check=True)
    print(f"Activated MuscleMap v{target_version} at Hugging Face bucket prefix {receipt['prefix']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
