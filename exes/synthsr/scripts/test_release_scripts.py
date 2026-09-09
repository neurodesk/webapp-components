#!/usr/bin/env python3
"""Exercise release failure handling without Apple tools or credentials."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class ReleaseScripts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        self.environment = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}"}

    def executable(self, name, source):
        path = self.bin / name
        path.write_text("#!/bin/sh\nset -eu\n" + source)
        path.chmod(0o755)
        return path

    def test_package_execution_failure_fails_verification(self):
        self.executable("pkgutil", '''
if [ "$1" = --expand-full ]; then
    mkdir -p "$3/usr/local/bin" "$3/usr/local/lib/synthsr"
    printf '#!/bin/sh\\nexit 42\\n' > "$3/usr/local/bin/synthsr"
    touch "$3/usr/local/lib/synthsr/libwebgpu_dawn.dylib"
fi
''')
        self.executable("codesign", "exit 0\n")
        self.executable("otool", "printf 'test:\\n /usr/lib/libSystem.B.dylib\\n'\n")
        package = self.directory / "test.pkg"
        package.touch()
        result = subprocess.run(
            ["sh", str(ROOT / "scripts/verify_macos_pkg.sh"), str(package)],
            env=self.environment, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
        self.assertNotIn("Verified", result.stdout)

    def release(self, fail_phase=""):
        log = self.directory / "phases"
        log.write_text("")
        make = self.executable("record-make", '''
printf '%s\\n' "$1" >> "$PHASE_LOG"
[ "$1" != "$FAIL_PHASE" ]
''')
        result = subprocess.run(
            ["make", "-j4", "-f", str(ROOT / "Makefile"), "macos-release", f"MAKE={make}"],
            cwd=ROOT,
            env={**self.environment, "PHASE_LOG": str(log), "FAIL_PHASE": fail_phase},
            capture_output=True, text=True,
        )
        return result, log.read_text().splitlines()

    def test_parallel_make_preserves_release_order(self):
        result, phases = self.release()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(phases, ["check-notary-profile", "test", "macos-pkg", "macos-notarize"])

    def test_failed_phase_prevents_later_release_actions(self):
        phases = ["check-notary-profile", "test", "macos-pkg", "macos-notarize"]
        for index, phase in enumerate(phases):
            with self.subTest(phase=phase):
                result, recorded = self.release(phase)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(recorded, phases[:index + 1])


if __name__ == "__main__":
    unittest.main()
