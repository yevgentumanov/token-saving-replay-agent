"""
Portable Windows launcher for Token Saving Replay Agent.

Called by start.bat after embedded Python is ready. It installs Python
dependencies, downloads llama-server.exe if needed, lets the user pick model
files, and starts the FastAPI browser app.
"""

import json
import subprocess
import sys
import time
import urllib.error
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

# Pinned llama.cpp release. CPU build works on every Windows machine; users can
# swap in CUDA or Vulkan builds manually by replacing bin/llama-server.exe.
LLAMA_TAG = "b8855"
LLAMA_ZIP_NAME = f"llama-{LLAMA_TAG}-bin-win-cpu-x64.zip"
LLAMA_DOWNLOAD_URL = (
    f"https://github.com/ggml-org/llama.cpp/releases/download"
    f"/{LLAMA_TAG}/{LLAMA_ZIP_NAME}"
)

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
    "model_a_provider": "local",
    "model_a_api_key": "",
    "model_a_cloud_model": "",
    "model_b_provider": "local",
    "model_b_api_key": "",
    "model_b_cloud_model": "",
}


def banner(text: str):
    print(f"\n  {text}")


def step(n: int, total: int, text: str):
    print(f"[{n}/{total}] {text}")


def ensure_deps():
    import hashlib

    req_file = BASE_DIR / "requirements.txt"
    req_hash = hashlib.sha256(req_file.read_bytes()).hexdigest()[:16]

    if DEPS_MARKER.exists() and DEPS_MARKER.read_text().strip() == req_hash:
        return

    step(1, 3, "Installing Python dependencies ...")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-r",
            str(req_file),
            "--no-warn-script-location",
            "--quiet",
        ],
        check=True,
    )
    DEPS_MARKER.write_text(req_hash)
    print("      Dependencies ready.")


def _download_with_progress(url: str, dest: Path):
    """Download url to dest, printing a simple progress indicator."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "token-saving-replay-agent"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            chunk = 1024 * 64
            with open(dest, "wb") as f:
                while True:
                    block = resp.read(chunk)
                    if not block:
                        break
                    f.write(block)
                    downloaded += len(block)
                    if total:
                        pct = downloaded * 100 // total
                        print(
                            f"\r      {pct:3d}%  "
                            f"({downloaded // 1024 // 1024} MB / {total // 1024 // 1024} MB) ",
                            end="",
                            flush=True,
                        )
        print()
    except urllib.error.URLError as e:
        dest.unlink(missing_ok=True)
        raise RuntimeError(
            f"Download failed: {e}\n\n"
            "  No internet access or the URL is unreachable.\n"
            "  Manual fix:\n"
            f"    1. Download: {LLAMA_DOWNLOAD_URL}\n"
            "    2. Extract llama-server.exe from the zip.\n"
            "    3. Place it in: .\\bin\\llama-server.exe\n"
            "    4. Re-run start.bat."
        ) from e


def ensure_llama_server() -> str:
    exe = BIN_DIR / "llama-server.exe"
    if exe.exists():
        return str(exe)

    BIN_DIR.mkdir(exist_ok=True)
    step(2, 3, f"Downloading llama-server ({LLAMA_TAG}); this happens only once ...")
    print(f"      URL: {LLAMA_DOWNLOAD_URL}")

    zip_path = BIN_DIR / LLAMA_ZIP_NAME
    _download_with_progress(LLAMA_DOWNLOAD_URL, zip_path)

    print("      Extracting llama-server.exe ...")
    with zipfile.ZipFile(zip_path) as z:
        for member in z.namelist():
            if Path(member).name == "llama-server.exe":
                target = BIN_DIR / "llama-server.exe"
                target.write_bytes(z.read(member))
                break
        else:
            zip_path.unlink(missing_ok=True)
            raise RuntimeError(
                "llama-server.exe was not found inside the downloaded zip.\n"
                f"  Archive: {zip_path.name}\n"
                "  Try downloading another llama.cpp build and placing\n"
                "  llama-server.exe in .\\bin\\ manually."
            )

    zip_path.unlink(missing_ok=True)
    print(f"      Saved to {exe}")
    return str(exe)


def _pick_file_powershell(title: str, initial_dir: str = "") -> str:
    """Open a native Windows file-open dialog via PowerShell."""
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
        capture_output=True,
        text=True,
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
    print("  Press Cancel to skip; you can configure models later in the web UI.")
    print()

    if model_a_missing:
        print("  --> Select your MAIN model (larger GGUF model, e.g. Qwen3-14B).")
        path = _pick_file_powershell("Select MAIN model - GGUF")
        if path:
            cfg["model_a_path"] = path
            changed = True
            print(f"      Main model: {path}")
        else:
            print("      Skipped. Configure it later in the web UI.")

    if model_b_missing:
        print("  --> Select your PATCHER model (small GGUF model, e.g. Qwen3-1.7B).")
        path = _pick_file_powershell("Select PATCHER model - GGUF")
        if path:
            cfg["model_b_path"] = path
            changed = True
            print(f"      Patcher model: {path}")
        else:
            print("      Skipped. Chat can run without Model B, but inline fixes will be disabled.")

    return cfg, changed


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    return DEFAULT_CONFIG.copy()


def save_config(cfg: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


def launch_app():
    banner("Starting Token Saving Replay Agent ...")
    print(f"  Browser will open at {APP_URL}")
    print("  Press Ctrl+C in this window to stop the app and model servers.")
    print()

    proc = subprocess.Popen([sys.executable, str(BASE_DIR / "main.py")])

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
