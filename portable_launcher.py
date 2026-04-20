"""
Portable launcher for Token Saving Replay Agent.
Called by start.bat after embedded Python is ready.
Handles: dep install, llama-server download, model selection, app launch.
"""

import json
import subprocess
import sys
import time
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.json"
BIN_DIR = BASE_DIR / "bin"
PYTHON_DIR = BASE_DIR / "python"
DEPS_MARKER = PYTHON_DIR / ".deps_installed"

APP_PORT = 7860
APP_URL = f"http://localhost:{APP_PORT}"


# ── Helpers ───────────────────────────────────────────────────────────────────

def banner(text: str):
    print(f"\n  {text}")


def step(n: int, total: int, text: str):
    print(f"[{n}/{total}] {text}")


# ── Step 1: Install Python dependencies ──────────────────────────────────────

def ensure_deps():
    if DEPS_MARKER.exists():
        return
    req_file = BASE_DIR / "requirements.txt"
    step(1, 3, "Installing Python dependencies (one-time) ...")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(req_file),
         "--no-warn-script-location", "--quiet"],
        check=True,
    )
    DEPS_MARKER.touch()
    print("      Dependencies ready!")


# ── Step 2: Download llama-server.exe ────────────────────────────────────────

def ensure_llama_server() -> str:
    exe = BIN_DIR / "llama-server.exe"
    if exe.exists():
        return str(exe)

    BIN_DIR.mkdir(exist_ok=True)
    step(2, 3, "Fetching latest llama.cpp release from GitHub ...")

    api_url = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest"
    req = urllib.request.Request(api_url, headers={"User-Agent": "token-saving-replay-agent"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())

    assets = data.get("assets", [])

    def _score(name: str) -> int:
        n = name.lower()
        if not ("win" in n and "x64" in n and n.endswith(".zip")):
            return -1
        # Prefer builds from best to most compatible
        if "vulkan" in n:  return 4
        if "avx2"   in n:  return 3
        if "avx512" in n:  return 2
        if "avx"    in n:  return 1
        return 0

    candidates = [((_score(a["name"]), a)) for a in assets]
    candidates = [(s, a) for s, a in candidates if s > 0]
    if not candidates:
        raise RuntimeError(
            "Could not find a Windows llama.cpp build on GitHub.\n"
            "Download llama-server.exe manually and place it in ./bin/"
        )

    _, best = max(candidates, key=lambda x: x[0])
    print(f"      Downloading {best['name']} ...")

    zip_path = BIN_DIR / best["name"]
    urllib.request.urlretrieve(best["browser_download_url"], str(zip_path))

    print("      Extracting files to ./bin/ ...")
    with zipfile.ZipFile(zip_path) as z:
        for member in z.namelist():
            # Flatten directory structure: extract everything to BIN_DIR
            filename = Path(member).name
            if not filename:
                continue
            target = BIN_DIR / filename
            target.write_bytes(z.read(member))

    zip_path.unlink()

    if not exe.exists():
        raise RuntimeError(
            "Extraction finished but llama-server.exe was not found in the archive.\n"
            "Please place it manually in ./bin/llama-server.exe"
        )

    print(f"      Saved to {exe}")
    return str(exe)


# ── Step 3: Model selection ───────────────────────────────────────────────────

def _pick_file_powershell(title: str, initial_dir: str = "") -> str:
    """Open a native Windows file-open dialog via PowerShell (no tkinter needed)."""
    init = initial_dir.replace("'", "") or str(Path.home())
    ps = (
        "Add-Type -AssemblyName System.Windows.Forms; "
        "$d = New-Object System.Windows.Forms.OpenFileDialog; "
        f"$d.Title = '{title}'; "
        "$d.Filter = 'GGUF models (*.gguf)|*.gguf|All files (*.*)|*.*'; "
        f"$d.InitialDirectory = '{init}'; "
        "if ($d.ShowDialog() -eq 'OK') { $d.FileName }"
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        capture_output=True, text=True,
    )
    return result.stdout.strip()


def ensure_models(cfg: dict) -> tuple[dict, bool]:
    """Prompt user to pick model files if not already configured."""
    changed = False

    model_a_missing = not cfg.get("model_a_path") or not Path(cfg["model_a_path"]).exists()
    model_b_missing = not cfg.get("model_b_path") or not Path(cfg["model_b_path"]).exists()

    if not model_a_missing and not model_b_missing:
        return cfg, False

    step(3, 3, "Model selection ...")
    print()
    print("  A file dialog will open for each model.")
    print("  Press Cancel to skip — you can configure models later in the web UI.")
    print()

    if model_a_missing:
        print("  --> Select your MAIN model (large LLM, e.g. Qwen3-14B, Gemma-4B ...)")
        path = _pick_file_powershell("Select MAIN model — large LLM (.gguf)")
        if path:
            cfg["model_a_path"] = path
            changed = True
            print(f"      Main model : {path}")
        else:
            print("      (skipped — configure via web UI)")

    if model_b_missing:
        print("  --> Select your PATCHER model (small LLM, e.g. Qwen3-1.7B, SmolLM ...)")
        path = _pick_file_powershell("Select PATCHER model — small LLM (.gguf)")
        if path:
            cfg["model_b_path"] = path
            changed = True
            print(f"      Patcher model: {path}")
        else:
            print("      (skipped — configure via web UI)")

    return cfg, changed


# ── Config ────────────────────────────────────────────────────────────────────

DEFAULT_CONFIG: dict = {
    "model_a_path": "",
    "model_a_args": "-c 16384 -ngl 99 -t 6 --no-mmap --flash-attn on",
    "model_a_port": 8080,
    "model_b_path": "",
    "model_b_args": "-c 4096 -ngl 0 -t 4",
    "model_b_port": 8081,
    "host": "0.0.0.0",
    "llama_server_path": "",
    "use_patcher": True,
}


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    return DEFAULT_CONFIG.copy()


def save_config(cfg: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


# ── Launch ────────────────────────────────────────────────────────────────────

def launch_app():
    banner("Starting Token Saving Replay Agent ...")
    print(f"  Browser will open at {APP_URL}")
    print("  Press Ctrl+C in this window to stop all servers.")
    print()

    proc = subprocess.Popen([sys.executable, str(BASE_DIR / "main.py")])

    # Give uvicorn a moment to bind the port before opening the browser
    time.sleep(2)
    webbrowser.open(APP_URL)

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\n  Stopping ...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    banner("Setup")
    print()

    try:
        ensure_deps()

        llama_exe = ensure_llama_server()

        cfg = load_config()
        cfg["llama_server_path"] = llama_exe
        cfg, _ = ensure_models(cfg)
        save_config(cfg)

        launch_app()

    except KeyboardInterrupt:
        print("\n  Cancelled.")
        sys.exit(0)
    except Exception as exc:
        print(f"\n  ERROR: {exc}")
        input("\n  Press Enter to close ...")
        sys.exit(1)


if __name__ == "__main__":
    main()
