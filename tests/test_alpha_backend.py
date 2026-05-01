import asyncio
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

import consolidation
import main
from consolidation import PatchRecord


class BackendAlphaTests(unittest.TestCase):
    def test_load_config_merges_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_config = main.CONFIG_FILE
            try:
                cfg_path = Path(tmp) / "config.json"
                cfg_path.write_text('{"model_a_port": 9000}', encoding="utf-8")
                main.CONFIG_FILE = cfg_path

                cfg = main.load_config()

                self.assertEqual(cfg["model_a_port"], 9000)
                self.assertEqual(cfg["model_b_port"], 8081)
                self.assertEqual(cfg["model_a_provider"], "local")
            finally:
                main.CONFIG_FILE = original_config

    def test_diagnostics_omits_secrets_and_raw_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_config = main.CONFIG_FILE
            try:
                cfg_path = Path(tmp) / "config.json"
                model_path = Path(tmp) / "model.gguf"
                llama_path = Path(tmp) / "llama-server"
                model_path.write_text("fake", encoding="utf-8")
                llama_path.write_text("fake", encoding="utf-8")
                cfg_path.write_text(
                    """
                    {
                      "llama_server_path": "%s",
                      "model_a_path": "%s",
                      "model_a_provider": "openai",
                      "model_a_api_key": "sk-secret",
                      "model_a_cloud_model": "gpt-test"
                    }
                    """
                    % (
                        str(llama_path).replace("\\", "\\\\"),
                        str(model_path).replace("\\", "\\\\"),
                    ),
                    encoding="utf-8",
                )
                main.CONFIG_FILE = cfg_path

                response = TestClient(main.app).get("/api/diagnostics")
                payload = response.json()
                serialized = response.text

                self.assertEqual(response.status_code, 200)
                self.assertEqual(payload["app_version"], "0.1.0-alpha")
                self.assertTrue(payload["llama_server_path_exists"])
                self.assertTrue(payload["model_a"]["path_exists"])
                self.assertNotIn("sk-secret", serialized)
                self.assertNotIn(str(model_path), serialized)
                self.assertNotIn(str(llama_path), serialized)
            finally:
                main.CONFIG_FILE = original_config

    def test_core_endpoints_respond_without_models(self):
        client = TestClient(main.app)
        for path in ["/api/status", "/api/config", "/api/consolidation/config", "/api/diagnostics", "/api/environment/detect"]:
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)

    def test_environment_detect_omits_secrets(self):
        response = TestClient(main.app).get("/api/environment/detect")
        serialized = response.text.lower()

        self.assertEqual(response.status_code, 200)
        self.assertIn("tools", response.json())
        self.assertNotIn("api_key", serialized)
        self.assertNotIn("sk-secret", serialized)
        self.assertNotIn("environment", serialized)

    def test_environment_version_parsing(self):
        self.assertEqual(main._version_from_output("Python 3.12.4\n", "Python"), "3.12.4")
        self.assertEqual(main._version_from_output("v22.1.0\n"), "22.1.0")
        self.assertEqual(main._version_from_output('openjdk version "17.0.10" 2024-01-16\n'), "17.0.10")

    def test_environment_tool_check_handles_stderr_and_timeout(self):
        completed = Mock(returncode=0, stdout="", stderr='openjdk version "21.0.2"\n')
        with patch("main.shutil.which", return_value="java"), patch("main.subprocess.run", return_value=completed):
            self.assertEqual(main._safe_tool_check(["java", "-version"])["version"], "21.0.2")

        with patch("main.shutil.which", return_value="node"), patch(
            "main.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="node", timeout=2),
        ):
            self.assertEqual(main._safe_tool_check(["node", "--version"]), {"found": False, "version": ""})

    def test_environment_os_normalization(self):
        self.assertEqual(main._normalize_os_name("Windows"), "Windows")
        self.assertEqual(main._normalize_os_name("Linux"), "Linux")
        self.assertEqual(main._normalize_os_name("Darwin"), "macOS")


class ConsolidationAlphaTests(unittest.TestCase):
    def test_threshold_modes(self):
        small = [
            PatchRecord(
                block_id="code-block-1",
                lang="bash",
                original="pip install fastapi",
                patched="uv add fastapi",
                source="inline",
            )
        ]
        many = small * consolidation.CONSOLIDATION_PATCH_THRESHOLD

        self.assertEqual(consolidation.should_run_consolidation(small)[1], "lightweight")
        self.assertEqual(consolidation.should_run_consolidation(many)[1], "full")

    def test_extract_content_from_reasoning_code_block(self):
        resp = {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "reasoning_content": 'thinking\n```json\n{"summary":"ok","state_delta":""}\n```',
                    }
                }
            ]
        }

        self.assertEqual(consolidation._extract_content(resp), '{"summary":"ok","state_delta":""}')

    def test_format_for_main_model_is_ascii_safe(self):
        result = consolidation.ConsolidationResult(
            changed_steps=[
                consolidation.ChangedStep(
                    step_id="code-block-1",
                    original="pip install fastapi",
                    patched="uv add fastapi",
                    reason="User uses uv.",
                )
            ],
            summary="Rewrote pip to uv.",
            state_delta="User uses uv.",
            patch_count=1,
            mode="full",
        )

        formatted = consolidation.format_for_main_model(result)
        self.assertIn("Consolidation Pass", formatted)
        self.assertIn("code-block-1", formatted)


class StaticAlphaTests(unittest.TestCase):
    def test_index_uses_local_vendor_assets(self):
        html = Path("static/index.html").read_text(encoding="utf-8")

        self.assertIn("/static/vendor/marked.min.js", html)
        self.assertIn("/static/vendor/purify.min.js", html)
        self.assertNotIn("cdn.jsdelivr", html)
        self.assertIn("diagnosticsBtn", html)
        self.assertIn("diagnosticsPanel", html)
        self.assertIn("profileDetect", html)
        self.assertIn("profileApplyDetect", html)
        self.assertIn("profileDetectPanel", html)

    def test_vendor_assets_exist(self):
        self.assertTrue(Path("static/vendor/marked.min.js").exists())
        self.assertTrue(Path("static/vendor/purify.min.js").exists())


if __name__ == "__main__":
    unittest.main()
