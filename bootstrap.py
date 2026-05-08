#!/usr/bin/env python3
"""
Cross-platform bootstrap helpers for the browser app.

Windows already has a dedicated portable Python path in start.bat and
portable_launcher.py. This module focuses on the repo/zip flow for macOS and
Linux: create a local venv, install dependencies when requirements change,
detect llama-server, and start the FastAPI app.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Optional


BASE_DIR = Path(__file__).parent.resolve()
APP_URL = "http://localhost:7860"
STATUS_URL = f"{APP_URL}/api/status"
APP_PORT = 7860
MIN_PYTHON = (3, 10)
VENV_DIR = BASE_DIR / ".venv"
BIN_DIR = BASE_DIR / "bin"
CONFIG_FILE = BASE_DIR / "config.json"
REQUIREMENTS_FILE = BASE_DIR / "requirements.txt"
DEPS_MARKER = VENV_DIR / ".deps_installed"


def banner(text: str) -> None:
    print(f"\n{text}")
    print("=" * len(text))


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kwargs)


def http_get_json(url: str, timeout: float = 1.5) -> Optional[dict]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def port_accepts(host: str, port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def describe_port_owner(port: int) -> str:
    system = platform.system()
    commands = []
    if system == "Windows":
        commands = [["netstat", "-ano", "-p", "tcp"]]
    else:
        commands = [["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN"]]
    for cmd in commands:
        if not shutil.which(cmd[0]):
            continue
        try:
            result = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=2)
        except (OSError, subprocess.SubprocessError):
            continue
        output = result.stdout.strip()
        if output:
            return output
    return "Port owner could not be detected."


def existing_app_status() -> Optional[dict]:
    payload = http_get_json(STATUS_URL)
    if isinstance(payload, dict) and "a" in payload and "b" in payload:
        return payload
    return None


def open_app_url() -> None:
    try:
        webbrowser.open(APP_URL)
    except Exception:
        pass


def guard_app_port() -> bool:
    status = existing_app_status()
    if status is not None:
        print(f"[0/4] App is already running at {APP_URL}.")
        print(
            "      Model A: "
            f"{'running' if status.get('a', {}).get('running') else 'stopped'}; "
            "Model B: "
            f"{'running' if status.get('b', {}).get('running') else 'stopped'}."
        )
        open_app_url()
        return False
    if port_accepts("127.0.0.1", APP_PORT):
        print(f"Port {APP_PORT} is already in use, but it is not this app.")
        print(describe_port_owner(APP_PORT))
        print("Stop that process or change the app port before launching.")
        return False
    return True


def version_tuple(executable: str) -> tuple[int, int, int]:
    code = "import sys; print('%d.%d.%d' % sys.version_info[:3])"
    result = subprocess.run(
        [executable, "-c", code],
        check=True,
        capture_output=True,
        text=True,
    )
    parts = result.stdout.strip().split(".")
    return (int(parts[0]), int(parts[1]), int(parts[2]))


def find_python() -> str:
    candidates = ["python3.12", "python3.11", "python3.10", "python3"]
    if platform.system() == "Windows":
        candidates = ["python", *candidates]
    for name in candidates:
        executable = shutil.which(name)
        if not executable:
            continue
        try:
            if version_tuple(executable)[:2] >= MIN_PYTHON:
                return executable
        except (subprocess.CalledProcessError, ValueError, OSError):
            continue
    raise SystemExit(
        "Python 3.10+ was not found.\n"
        "macOS: install Python from https://www.python.org/downloads/ or Homebrew (`brew install python`).\n"
        "Linux: install python3.10+ and python3-venv with your package manager."
    )


def venv_python() -> Path:
    if platform.system() == "Windows":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def requirements_hash() -> str:
    return hashlib.sha256(REQUIREMENTS_FILE.read_bytes()).hexdigest()[:16]


def ensure_venv() -> Path:
    py = venv_python()
    if py.exists():
        return py
    source_python = find_python()
    print(f"[1/4] Creating virtual environment with {source_python} ...")
    run([source_python, "-m", "venv", str(VENV_DIR)])
    return py


def ensure_deps(py: Path) -> None:
    marker = f"requirements:{requirements_hash()}"
    if DEPS_MARKER.exists() and DEPS_MARKER.read_text(encoding="utf-8").strip() == marker:
        print("[2/4] Python dependencies ready.")
        return
    print("[2/4] Installing Python dependencies ...")
    run([str(py), "-m", "pip", "install", "--upgrade", "pip"])
    run([str(py), "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)])
    DEPS_MARKER.write_text(marker, encoding="utf-8")
    print("      Dependencies ready.")


def llama_binary_name() -> str:
    return "llama-server.exe" if platform.system() == "Windows" else "llama-server"


def find_llama_server() -> str:
    bundled = BIN_DIR / llama_binary_name()
    if bundled.exists():
        return str(bundled)
    found = shutil.which("llama-server")
    return found or ""


def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(data: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def sync_llama_path(llama_path: str) -> None:
    if not llama_path:
        return
    cfg = load_config()
    if cfg.get("llama_server_path") == llama_path:
        return
    cfg["llama_server_path"] = llama_path
    save_config(cfg)


def print_local_model_guidance(llama_path: str) -> None:
    if llama_path:
        print(f"[3/4] Local GGUF ready: llama-server found at {llama_path}")
        return

    print("[3/4] Cloud mode ready. Local GGUF needs llama-server.")
    system = platform.system()
    machine = platform.machine().lower()
    if system == "Darwin":
        print("      MacBook local setup:")
        print("        brew install llama.cpp")
        print("      Then restart this launcher or select llama-server in the Launcher tab.")
        if "arm" in machine or "aarch64" in machine:
            print("      Apple Silicon uses Metal acceleration in modern llama.cpp builds.")
    elif system == "Linux":
        print("      Linux local setup:")
        print("        install/build llama.cpp, then put llama-server on PATH or in ./bin/")
    else:
        print("      Put llama-server on PATH or in ./bin/.")


def maybe_install_llama_with_brew() -> None:
    if platform.system() != "Darwin" or find_llama_server():
        return
    if not shutil.which("brew"):
        return
    if os.environ.get("TSRA_AUTO_INSTALL_LLAMA") != "1":
        print("      Tip: run with TSRA_AUTO_INSTALL_LLAMA=1 to install llama.cpp via Homebrew.")
        return
    print("      Installing llama.cpp via Homebrew ...")
    run(["brew", "install", "llama.cpp"])


def start_app(py: Path) -> None:
    print(f"[4/4] Starting app at {APP_URL} ...")
    os.execv(str(py), [str(py), str(BASE_DIR / "main.py")])


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Bootstrap Token Saving Replay Agent.")
    parser.add_argument("--check", action="store_true", help="Prepare and print setup state without starting the app.")
    args = parser.parse_args(argv)

    banner("Token Saving Replay Agent")
    if not args.check and not guard_app_port():
        return 0
    py = ensure_venv()
    ensure_deps(py)
    maybe_install_llama_with_brew()
    llama_path = find_llama_server()
    sync_llama_path(llama_path)
    print_local_model_guidance(llama_path)
    if args.check:
        print("Setup check complete.")
        return 0
    start_app(py)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
