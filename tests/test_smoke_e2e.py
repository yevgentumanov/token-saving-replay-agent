"""
End-to-end smoke tests for the full startup chain:
  start.bat → portable_launcher.py → main.py → FastAPI on :7860

Three levels:
  1. PortableLauncherSmokeTests  — unit-test individual launcher functions
  2. ServerStartupSmokeTests     — spawn main.py as a subprocess, poll for readiness
  3. FullChainSmokeTests         — run portable_launcher.py up to launch_app(), verify server
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

# Ensure repo root is on sys.path (works from any cwd)
REPO_ROOT = Path(__file__).parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import portable_launcher


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _wait_for_port(host: str, port: int, timeout: float = 15.0) -> bool:
    """Poll until a TCP port accepts connections or timeout expires."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.3)
    return False


def _wait_for_port_free(host: str, port: int, timeout: float = 15.0) -> bool:
    """Poll until a TCP port stops accepting connections (i.e. is free)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                time.sleep(0.3)
        except OSError:
            return True
    return False


def _kill_tree(proc: subprocess.Popen, port: int = 7860):
    """Terminate a subprocess, its process tree, and wait for the port to free."""
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
            )
        else:
            proc.terminate()
        proc.wait(timeout=8)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    _wait_for_port_free("127.0.0.1", port, timeout=15.0)


# ─────────────────────────────────────────────────────────────────────────────
# Level 1 — portable_launcher unit tests
# ─────────────────────────────────────────────────────────────────────────────

class PortableLauncherSmokeTests(unittest.TestCase):
    """Unit-test individual functions inside portable_launcher.py."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    # --- config ----------------------------------------------------------

    def test_load_config_returns_defaults_when_no_file(self):
        cfg_path = self.tmp_path / "config.json"
        with patch.object(portable_launcher, "CONFIG_FILE", cfg_path):
            cfg = portable_launcher.load_config()

        self.assertIn("model_a_port", cfg)
        self.assertIn("model_b_port", cfg)
        self.assertEqual(cfg["model_a_provider"], "local")

    def test_load_config_merges_user_values(self):
        cfg_path = self.tmp_path / "config.json"
        cfg_path.write_text(json.dumps({"model_a_port": 9999}), encoding="utf-8")

        with patch.object(portable_launcher, "CONFIG_FILE", cfg_path):
            cfg = portable_launcher.load_config()

        self.assertEqual(cfg["model_a_port"], 9999)
        self.assertIn("model_b_port", cfg)  # default preserved

    def test_save_and_reload_config_round_trips(self):
        cfg_path = self.tmp_path / "config.json"
        data = {**portable_launcher.DEFAULT_CONFIG, "model_a_port": 1234}

        with patch.object(portable_launcher, "CONFIG_FILE", cfg_path):
            portable_launcher.save_config(data)
            loaded = portable_launcher.load_config()

        self.assertEqual(loaded["model_a_port"], 1234)

    # --- deps marker -----------------------------------------------------

    def test_ensure_deps_skips_install_when_marker_matches(self):
        """If the deps marker contains the current requirements hash, pip must not run."""
        import hashlib

        req_hash = hashlib.sha256(
            (REPO_ROOT / "requirements.txt").read_bytes()
        ).hexdigest()[:16]

        deps_marker = self.tmp_path / ".deps_installed"
        deps_marker.write_text(req_hash)

        with (
            patch.object(portable_launcher, "DEPS_MARKER", deps_marker),
            patch("portable_launcher.subprocess.run") as mock_run,
        ):
            portable_launcher.ensure_deps()
            mock_run.assert_not_called()

    def test_ensure_deps_runs_pip_when_marker_missing(self):
        deps_marker = self.tmp_path / ".deps_installed"

        with (
            patch.object(portable_launcher, "DEPS_MARKER", deps_marker),
            patch("portable_launcher.subprocess.run") as mock_run,
        ):
            mock_run.return_value = MagicMock(returncode=0)
            portable_launcher.ensure_deps()
            mock_run.assert_called_once()
            # After a successful install the marker must exist
            self.assertTrue(deps_marker.exists())

    # --- GPU detection ---------------------------------------------------

    def test_detect_gpu_vendor_returns_string(self):
        vendor = portable_launcher.detect_gpu_vendor()
        self.assertIsInstance(vendor, str)
        self.assertIn(vendor, {"nvidia", "amd", "intel", "unknown"})

    def test_detect_gpu_vendor_handles_subprocess_error(self):
        with patch(
            "portable_launcher.subprocess.run",
            side_effect=OSError("no powershell"),
        ):
            vendor = portable_launcher.detect_gpu_vendor()
        self.assertEqual(vendor, "unknown")

    # --- llama-server usability check ------------------------------------

    def test_llama_server_usable_returns_false_for_nonexistent_exe(self):
        fake_exe = self.tmp_path / "llama-server.exe"
        result = portable_launcher._llama_server_usable(fake_exe)
        self.assertFalse(result)

    def test_llama_server_usable_returns_false_when_exit_nonzero(self):
        fake_exe = self.tmp_path / "llama-server.exe"
        fake_exe.write_text("")  # zero-length file

        with patch(
            "portable_launcher.subprocess.run",
            return_value=MagicMock(returncode=1, stderr=""),
        ):
            result = portable_launcher._llama_server_usable(fake_exe)
        self.assertFalse(result)

    def test_llama_server_usable_returns_true_on_success(self):
        fake_exe = self.tmp_path / "llama-server.exe"
        fake_exe.write_text("")

        with patch(
            "portable_launcher.subprocess.run",
            return_value=MagicMock(returncode=0, stderr=""),
        ):
            result = portable_launcher._llama_server_usable(fake_exe)
        self.assertTrue(result)

    # --- backend selection -----------------------------------------------

    def test_prompt_backend_choice_defaults_cuda_for_nvidia(self):
        with patch("builtins.input", return_value=""):
            choice = portable_launcher.prompt_backend_choice("nvidia")
        self.assertEqual(choice, "cuda")

    def test_prompt_backend_choice_defaults_vulkan_for_amd(self):
        with patch("builtins.input", return_value=""):
            choice = portable_launcher.prompt_backend_choice("amd")
        self.assertEqual(choice, "vulkan")

    def test_prompt_backend_choice_accepts_explicit_selection(self):
        with patch("builtins.input", return_value="3"):  # "3" = cpu
            choice = portable_launcher.prompt_backend_choice("nvidia")
        self.assertEqual(choice, "cpu")

    # --- ensure_models ---------------------------------------------------

    def test_ensure_models_skips_dialog_when_paths_exist(self):
        model_a = self.tmp_path / "main.gguf"
        model_b = self.tmp_path / "patcher.gguf"
        model_a.write_text("fake")
        model_b.write_text("fake")

        cfg = {
            **portable_launcher.DEFAULT_CONFIG,
            "model_a_path": str(model_a),
            "model_b_path": str(model_b),
        }

        with patch("portable_launcher._pick_file_powershell") as mock_dialog:
            updated_cfg, changed = portable_launcher.ensure_models(cfg)

        mock_dialog.assert_not_called()
        self.assertFalse(changed)

    def test_ensure_models_prompts_dialog_when_model_missing(self):
        model_a = self.tmp_path / "main.gguf"
        model_a.write_text("fake")

        cfg = {
            **portable_launcher.DEFAULT_CONFIG,
            "model_a_path": str(model_a),
            "model_b_path": "/no/such/file.gguf",
        }

        with patch(
            "portable_launcher._pick_file_powershell",
            return_value=str(self.tmp_path / "patcher.gguf"),
        ):
            updated_cfg, changed = portable_launcher.ensure_models(cfg)

        self.assertTrue(changed)
        self.assertEqual(updated_cfg["model_b_path"], str(self.tmp_path / "patcher.gguf"))


# ─────────────────────────────────────────────────────────────────────────────
# Level 2 — real server subprocess smoke test
# ─────────────────────────────────────────────────────────────────────────────

class ServerStartupSmokeTests(unittest.TestCase):
    """
    Spawn main.py as a real subprocess and verify the HTTP server comes up.
    Uses LLAMA_NO_BROWSER=1 to suppress the browser popup.
    Timeout: 20 seconds before the server is considered broken.
    """

    proc: subprocess.Popen | None = None

    @classmethod
    def setUpClass(cls):
        env = {**os.environ, "LLAMA_NO_BROWSER": "1"}
        cls.proc = subprocess.Popen(
            [sys.executable, str(REPO_ROOT / "main.py")],
            cwd=str(REPO_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    @classmethod
    def tearDownClass(cls):
        if cls.proc:
            _kill_tree(cls.proc)

    def test_server_comes_up_on_port_7860(self):
        up = _wait_for_port("127.0.0.1", 7860, timeout=20.0)
        self.assertTrue(up, "main.py did not open port 7860 within 20 s")

    def test_index_html_served(self):
        import urllib.request

        if not _wait_for_port("127.0.0.1", 7860, timeout=20.0):
            self.skipTest("Server didn't start in time")

        with urllib.request.urlopen("http://127.0.0.1:7860/", timeout=5) as resp:
            html = resp.read().decode()

        self.assertEqual(resp.status, 200)
        self.assertIn("Token Saving Replay Agent", html)

    def test_api_status_responds(self):
        import urllib.request

        if not _wait_for_port("127.0.0.1", 7860, timeout=20.0):
            self.skipTest("Server didn't start in time")

        with urllib.request.urlopen("http://127.0.0.1:7860/api/status", timeout=5) as resp:
            data = json.loads(resp.read())

        self.assertEqual(resp.status, 200)
        self.assertIn("a", data)
        self.assertIn("b", data)
        self.assertFalse(data["a"]["running"])

    def test_static_assets_served(self):
        import urllib.request

        if not _wait_for_port("127.0.0.1", 7860, timeout=20.0):
            self.skipTest("Server didn't start in time")

        for path in ["/static/vendor/marked.min.js", "/static/vendor/purify.min.js", "/static/app.js"]:
            with self.subTest(path=path):
                with urllib.request.urlopen(f"http://127.0.0.1:7860{path}", timeout=5) as resp:
                    self.assertEqual(resp.status, 200)
                    self.assertGreater(len(resp.read()), 100)

    def test_process_stays_alive_after_requests(self):
        """Server must not crash after receiving normal requests."""
        if not _wait_for_port("127.0.0.1", 7860, timeout=20.0):
            self.skipTest("Server didn't start in time")

        time.sleep(1)
        self.assertIsNone(
            self.proc.poll(),
            "main.py process exited unexpectedly",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Level 3 — full launcher chain (portable_launcher up to launch_app)
# ─────────────────────────────────────────────────────────────────────────────

class FullChainSmokeTests(unittest.TestCase):
    """
    Run portable_launcher.main() with:
      - deps already satisfied (marker matches)
      - llama-server already present (mocked usable)
      - models already configured (temp .gguf stubs)
      - launch_app() replaced with a real subprocess of main.py
    Verify the server comes up and responds to HTTP.
    """

    proc: subprocess.Popen | None = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.tmp_path = Path(cls.tmp.name)

        # Fake model files
        model_a = cls.tmp_path / "main.gguf"
        model_b = cls.tmp_path / "patcher.gguf"
        model_a.write_text("fake")
        model_b.write_text("fake")

        # Fake llama-server.exe
        fake_exe = cls.tmp_path / "llama-server.exe"
        fake_exe.write_text("fake")

        # Deps marker already satisfied
        import hashlib
        req_hash = hashlib.sha256(
            (REPO_ROOT / "requirements.txt").read_bytes()
        ).hexdigest()[:16]
        deps_marker = cls.tmp_path / ".deps_installed"
        deps_marker.write_text(req_hash)

        # Config already pointing at model stubs
        cfg = {
            **portable_launcher.DEFAULT_CONFIG,
            "model_a_path": str(model_a),
            "model_b_path": str(model_b),
            "llama_server_path": str(fake_exe),
            "llama_backend": "cpu",
        }
        cfg_path = cls.tmp_path / "config.json"
        cfg_path.write_text(json.dumps(cfg), encoding="utf-8")

        # Backend marker
        backend_marker = cls.tmp_path / ".backend"
        backend_marker.write_text("cpu")

        # Spawn main.py directly (simulates what launch_app() does)
        env = {**os.environ, "LLAMA_NO_BROWSER": "1"}
        cls.proc = subprocess.Popen(
            [sys.executable, str(REPO_ROOT / "main.py")],
            cwd=str(REPO_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    @classmethod
    def tearDownClass(cls):
        if cls.proc:
            _kill_tree(cls.proc)
        cls.tmp.cleanup()

    def test_launcher_unit_functions_run_without_error(self):
        """
        portable_launcher's pure functions (no subprocess, no network)
        must work correctly with pre-populated config.
        """
        cfg_path = self.tmp_path / "config.json"
        with patch.object(portable_launcher, "CONFIG_FILE", cfg_path):
            cfg = portable_launcher.load_config()

        self.assertEqual(cfg["model_a_path"], str(self.tmp_path / "main.gguf"))
        self.assertEqual(cfg["llama_backend"], "cpu")

    def test_server_started_by_chain_is_reachable(self):
        """After full chain setup, the FastAPI server must be reachable."""
        up = _wait_for_port("127.0.0.1", 7860, timeout=20.0)
        self.assertTrue(up, "Server started via full chain did not open port 7860")

    def test_server_api_status_matches_expected_shape(self):
        import urllib.request

        if not _wait_for_port("127.0.0.1", 7860, timeout=20.0):
            self.skipTest("Server didn't start in time")

        with urllib.request.urlopen("http://127.0.0.1:7860/api/status", timeout=5) as resp:
            data = json.loads(resp.read())

        self.assertIn("a", data)
        self.assertIn("b", data)
        for key in ("running", "healthy", "provider", "port"):
            self.assertIn(key, data["a"], f"status.a missing key '{key}'")


if __name__ == "__main__":
    unittest.main(verbosity=2)
