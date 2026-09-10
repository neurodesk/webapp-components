#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[3]
MODULE_PATH = pathlib.Path(__file__).with_name("portable_release.py")
SPEC = importlib.util.spec_from_file_location("portable_release", MODULE_PATH)
portable_release = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = portable_release
SPEC.loader.exec_module(portable_release)


class PortableReleaseTests(unittest.TestCase):
    def test_commands_are_resolved_with_the_supplied_path(self):
        environment = {"PATH": "portable-tools"}
        with mock.patch.object(portable_release.shutil, "which", return_value="/portable-tools/pnpm.CMD") as which:
            with mock.patch.object(portable_release.subprocess, "run") as run:
                portable_release._run(["pnpm", "--version"], env=environment)
        which.assert_called_once_with("pnpm", path="portable-tools")
        run.assert_called_once_with(
            ["/portable-tools/pnpm.CMD", "--version"],
            cwd=ROOT,
            env=environment,
            check=True,
            text=True,
            stdout=portable_release.subprocess.PIPE,
            stderr=portable_release.subprocess.STDOUT,
        )

    def test_release_target_derives_safe_names(self):
        target = portable_release.load_target(ROOT, "linux-x64")
        version = json.loads((ROOT / "packages/syncro/package.json").read_text(encoding="utf8"))["version"]
        self.assertEqual(target.version, version)
        self.assertEqual(target.archive_name, f"syncro-{version}-linux-x64.tar.gz")
        self.assertEqual(target.executable, "syncro")

    def test_unknown_target_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "target"):
            portable_release.load_target(ROOT, "linux-arm64")

    def test_manifest_rejects_symlinks_and_path_escape(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / "file.txt").write_text("safe", encoding="utf8")
            manifest = portable_release.create_manifest(root, "0.1.20260910", "linux-x64")
            self.assertEqual([entry["path"] for entry in manifest["files"]], ["file.txt"])
            try:
                (root / "link").symlink_to(root / "file.txt")
            except OSError:
                self.skipTest("this Windows runner cannot create test symlinks")
            with self.assertRaisesRegex(ValueError, "symlink"):
                portable_release.create_manifest(root, "0.1.20260910", "linux-x64")

    def test_onnx_pruner_keeps_only_the_linux_cpu_runtime(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = pathlib.Path(temporary)
            runtime = app / "node_modules/onnxruntime-node/bin/napi-v6"
            linux = runtime / "linux/x64"
            linux.mkdir(parents=True)
            for name in (
                "onnxruntime_binding.node",
                "libonnxruntime.so.1",
                "libonnxruntime_providers_shared.so",
                "libonnxruntime_providers_cuda.so",
                "libonnxruntime_providers_tensorrt.so",
            ):
                (linux / name).write_text(name)
            windows = runtime / "win32/x64"
            windows.mkdir(parents=True)
            (windows / "onnxruntime_binding.node").write_text("foreign")
            portable_release._prune_onnx_runtime(app, portable_release.load_target(ROOT, "linux-x64"))
            self.assertEqual(
                sorted(path.name for path in linux.iterdir()),
                ["libonnxruntime.so.1", "libonnxruntime_providers_shared.so", "onnxruntime_binding.node"],
            )
            self.assertFalse((runtime / "win32").exists())

    def test_runtime_catalog_has_pinned_node_archives(self):
        catalog = json.loads((ROOT / "exes/syncro/node-runtimes.json").read_text())
        self.assertEqual(catalog["version"], "22.22.0")
        for target in ("linux-x64", "windows-x64"):
            self.assertRegex(catalog["targets"][target]["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
