import asyncio
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch, MagicMock

from fastapi.testclient import TestClient

import consolidation
import main
from consolidation import PatchRecord
from llm_clients import BaseLLMClient


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


class MockLLMClient(BaseLLMClient):
    """Mock LLM client for smoke testing without real models."""

    async def chat_stream(self, messages: list, **kwargs):
        """Yield mock SSE response chunks."""
        response_text = "This is a mock response from the LLM."
        # Simulate SSE format: "data: {json}\n\n"
        for i, chunk in enumerate(response_text.split()):
            sse_chunk = f'data: {{"choices":[{{"delta":{{"content":"{chunk} "}}}}]}}\n\n'.encode()
            yield sse_chunk

    async def chat_complete(self, messages: list, **kwargs) -> dict:
        """Return a complete mock response."""
        return {
            "choices": [
                {
                    "message": {
                        "content": "This is a complete mock response from the LLM."
                    }
                }
            ]
        }

    async def health_check(self) -> bool:
        """Always healthy in mock."""
        return True


class SmokeTests(unittest.TestCase):
    """Smoke tests verifying core API endpoints and flows."""

    def setUp(self):
        """Set up test fixtures."""
        self.client = TestClient(main.app)

    def test_smoke_core_endpoints_return_valid_json(self):
        """Smoke test: verify all core endpoints return 200 and valid JSON."""
        endpoints = [
            "/api/status",
            "/api/config",
            "/api/diagnostics",
            "/api/environment/detect",
            "/api/consolidation/config",
        ]
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                resp = self.client.get(endpoint)
                self.assertEqual(resp.status_code, 200, f"Endpoint {endpoint} failed")
                # Verify valid JSON response
                data = resp.json()
                self.assertIsInstance(data, (dict, list))

    def test_smoke_status_structure_is_correct(self):
        """Smoke test: verify /api/status returns correct structure."""
        resp = self.client.get("/api/status")
        self.assertEqual(resp.status_code, 200)
        status = resp.json()

        # Verify model A status structure
        self.assertIn("a", status)
        self.assertIn("running", status["a"])
        self.assertIn("healthy", status["a"])
        self.assertIn("provider", status["a"])
        self.assertIn("port", status["a"])

        # Verify model B status structure
        self.assertIn("b", status)
        self.assertIn("running", status["b"])
        self.assertIn("healthy", status["b"])

    def test_smoke_config_endpoint_reflects_defaults(self):
        """Smoke test: /api/config returns default configuration."""
        resp = self.client.get("/api/config")
        self.assertEqual(resp.status_code, 200)
        config = resp.json()

        # Verify essential config keys exist
        self.assertIn("model_a_provider", config)
        self.assertIn("model_a_port", config)
        self.assertIn("model_b_port", config)
        self.assertIn("use_patcher", config)

    def test_smoke_diagnostics_omits_secrets(self):
        """Smoke test: /api/diagnostics doesn't expose sensitive data."""
        resp = self.client.get("/api/diagnostics")
        self.assertEqual(resp.status_code, 200)
        response_text = resp.text

        # Verify no API keys in response
        self.assertNotIn("sk-", response_text.lower())
        self.assertNotIn("api_key", response_text.lower())

    def test_smoke_environment_detect_includes_tools(self):
        """Smoke test: /api/environment/detect returns tool info."""
        resp = self.client.get("/api/environment/detect")
        self.assertEqual(resp.status_code, 200)
        env = resp.json()

        # Verify expected fields
        self.assertIn("shell", env)
        self.assertIn("os", env)
        self.assertIn("tools", env)
        self.assertIsInstance(env["tools"], dict)

    def test_smoke_start_request_validation_rejects_invalid_input(self):
        """Smoke test: /api/start validates input and rejects malformed requests."""
        # Send invalid request (missing required model_a)
        resp = self.client.post(
            "/api/start",
            json={}
        )
        # Should get 422 (validation error) not 500 (crash)
        self.assertEqual(resp.status_code, 422)

    def test_smoke_start_request_rejects_missing_model_path(self):
        """Smoke test: /api/start rejects local models without valid path."""
        resp = self.client.post(
            "/api/start",
            json={
                "model_a": {
                    "provider": "local",
                    "path": "/nonexistent/model.gguf",
                    "port": 8080,
                },
                "host": "0.0.0.0"
            }
        )
        # Should get 400 (bad request) not 500 (crash)
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
