"""
Portable Windows launcher for Token Saving Replay Agent.

Called by start.bat after embedded Python is ready. It installs Python
dependencies, downloads llama-server.exe if needed, lets the user pick model
files, and starts the FastAPI browser app.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from app_logging import append_startup_event, get_logger, log_error, log_event, setup_logging

setup_logging()
logger = get_logger(__name__)

CONFIG_FILE = BASE_DIR / "config.json"
BIN_DIR = BASE_DIR / "bin"
PYTHON_DIR = BASE_DIR / "python"
DEPS_MARKER = PYTHON_DIR / ".deps_installed"

APP_PORT = 7860
APP_URL = f"http://localhost:{APP_PORT}"

# Pinned llama.cpp release. We pick a backend at first run so GPU users get
# real acceleration. To switch backend later, delete the bin/ folder.
LLAMA_TAG = "b8855"
LLAMA_RELEASE_BASE = (
    f"https://github.com/ggml-org/llama.cpp/releases/download/{LLAMA_TAG}"
)
LLAMA_BACKEND_FILES = {
    "cuda":   f"llama-{LLAMA_TAG}-bin-win-cuda-12.4-x64.zip",
    "vulkan": f"llama-{LLAMA_TAG}-bin-win-vulkan-x64.zip",
    "cpu":    f"llama-{LLAMA_TAG}-bin-win-cpu-x64.zip",
}
LLAMA_CUDA_RUNTIME_FILE = "cudart-llama-bin-win-cuda-12.4-x64.zip"
BACKEND_MARKER = BIN_DIR / ".backend"

DEFAULT_CONFIG: dict = {
    "model_a_path": "",
    "model_a_args": "-c 16384 -ngl 99 -t 6 --no-mmap --flash-attn on",
    "model_a_port": 8080,
    "model_b_path": "",
    "model_b_args": "-c 4096 -ngl 0 -t 4",
    "model_b_port": 8081,
    "host": "0.0.0.0",
    "llama_server_path": "",
    "llama_backend": "",
    "use_patcher": True,
    "model_a_provider": "local",
    "model_a_api_key": "",
    "model_a_cloud_model": "",
    "model_b_provider": "local",
    "model_b_api_key": "",
    "model_b_cloud_model": "",
}


def banner(text: str):
    append_startup_event("portable.banner", text=text)
    print(f"\n  {text}")


def step(n: int, total: int, text: str):
    append_startup_event("portable.step", step=n, total=total, text=text)
    print(f"[{n}/{total}] {text}")


def ensure_deps():
    import hashlib

    req_file = BASE_DIR / "requirements.txt"
    req_hash = hashlib.sha256(req_file.read_bytes()).hexdigest()[:16]
    append_startup_event("portable.deps.check", requirements=str(req_file), hash=req_hash)
    log_event(logger, "portable.deps.check", requirements=str(req_file), hash=req_hash)

    if DEPS_MARKER.exists() and DEPS_MARKER.read_text().strip() == req_hash:
        append_startup_event("portable.deps.ready_marker_found", marker=str(DEPS_MARKER))
        log_event(logger, "portable.deps.ready_marker_found", marker=str(DEPS_MARKER))
        return

    step(1, 3, "Installing Python dependencies ...")
    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "-r",
        str(req_file),
        "--no-warn-script-location",
        "--quiet",
    ]
    append_startup_event("portable.deps.install.start", command=cmd)
    log_event(logger, "portable.deps.install.start", command=cmd)
    try:
        subprocess.run(cmd, check=True)
    except Exception as exc:
        append_startup_event("portable.deps.install.failed", error=str(exc))
        log_error(logger, "portable.deps.install.failed", exc)
        raise
    DEPS_MARKER.write_text(req_hash)
    append_startup_event("portable.deps.install.done", marker=str(DEPS_MARKER))
    log_event(logger, "portable.deps.install.done", marker=str(DEPS_MARKER))
    print("      Dependencies ready.")


def _download_with_progress(url: str, dest: Path):
    """Download url to dest, printing a simple progress indicator."""
    append_startup_event("portable.download.start", url=url, dest=str(dest))
    log_event(logger, "portable.download.start", url=url, dest=str(dest))
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
        append_startup_event("portable.download.done", url=url, dest=str(dest), bytes=dest.stat().st_size if dest.exists() else 0)
        log_event(logger, "portable.download.done", url=url, dest=str(dest), bytes=dest.stat().st_size if dest.exists() else 0)
    except urllib.error.URLError as e:
        dest.unlink(missing_ok=True)
        append_startup_event("portable.download.failed", url=url, dest=str(dest), error=str(e))
        log_error(logger, "portable.download.failed", e, url=url, dest=str(dest))
        raise RuntimeError(
            f"Download failed: {e}\n\n"
            "  No internet access or the URL is unreachable.\n"
            "  Manual fix:\n"
            f"    1. Download: {url}\n"
            "    2. Extract llama-server.exe (and any .dll files) from the zip.\n"
            "    3. Place them in: .\\bin\\\n"
            "    4. Re-run start.bat."
        ) from e


def detect_gpu_vendor() -> str:
    """Best-effort detection of the primary GPU vendor on Windows."""
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        append_startup_event("portable.gpu.detect.failed", error=str(exc))
        log_event(logger, "portable.gpu.detect.failed", error=str(exc))
        return "unknown"

    text = (result.stdout or "").lower()
    append_startup_event("portable.gpu.detect", names=result.stdout.strip())
    log_event(logger, "portable.gpu.detect", names=result.stdout.strip())
    if "nvidia" in text or "geforce" in text or "rtx" in text or "quadro" in text:
        return "nvidia"
    if "radeon" in text or "amd" in text:
        return "amd"
    if "intel" in text:
        return "intel"
    return "unknown"


def prompt_backend_choice(detected: str) -> str:
    """Ask the user which llama.cpp backend to download. Returns a key of LLAMA_BACKEND_FILES."""
    if detected == "nvidia":
        recommended = "cuda"
    elif detected in ("amd", "intel", "unknown"):
        recommended = "vulkan"
    else:
        recommended = "vulkan"

    options = [
        ("cuda",   "CUDA   - NVIDIA only, fastest"),
        ("vulkan", "Vulkan - works on any GPU (NVIDIA / AMD / Intel)"),
        ("cpu",    "CPU    - no GPU acceleration"),
    ]
    rec_idx = next(i for i, (k, _) in enumerate(options) if k == recommended) + 1

    print()
    print(f"  Detected GPU vendor: {detected}")
    print("  Choose llama-server backend:")
    for i, (key, label) in enumerate(options, start=1):
        marker = "  <-- recommended" if key == recommended else ""
        print(f"    [{i}] {label}{marker}")
    print()

    while True:
        try:
            raw = input(f"  Enter choice [{rec_idx}]: ").strip()
        except EOFError:
            raw = ""
        if not raw:
            choice = recommended
            break
        if raw in ("1", "2", "3"):
            choice = options[int(raw) - 1][0]
            break
        print("  Invalid choice, please enter 1, 2, or 3 (or press Enter for recommended).")

    append_startup_event("portable.backend.choose", detected=detected, chosen=choice, recommended=recommended)
    log_event(logger, "portable.backend.choose", detected=detected, chosen=choice, recommended=recommended)
    return choice


def _extract_runtime_zip(zip_path: Path, require_server: bool) -> bool:
    """Extract llama-server.exe and runtime DLLs from a llama.cpp release zip into BIN_DIR.
    Returns True if llama-server.exe was found in this zip."""
    found_server = False
    extracted = 0
    with zipfile.ZipFile(zip_path) as z:
        for member in z.namelist():
            name = Path(member).name
            if not name:
                continue
            suffix = Path(name).suffix.lower()
            if name == "llama-server.exe" or suffix in {".dll", ".pdb"}:
                (BIN_DIR / name).write_bytes(z.read(member))
                extracted += 1
                if name == "llama-server.exe":
                    found_server = True
    append_startup_event(
        "portable.llama_server.extract.done",
        archive=zip_path.name,
        extracted_runtime_files=extracted,
        had_server=found_server,
    )
    log_event(
        logger,
        "portable.llama_server.extract.done",
        archive=zip_path.name,
        extracted_runtime_files=extracted,
        had_server=found_server,
    )
    if require_server and not found_server:
        raise RuntimeError(
            "llama-server.exe was not found inside the downloaded zip.\n"
            f"  Archive: {zip_path.name}\n"
            "  Try downloading another llama.cpp build and placing\n"
            "  llama-server.exe in .\\bin\\ manually."
        )
    return found_server


def ensure_llama_server() -> tuple[str, str]:
    """Ensure bin/llama-server.exe exists for a chosen backend. Returns (exe_path, backend_key)."""
    exe = BIN_DIR / "llama-server.exe"
    marker_backend = BACKEND_MARKER.read_text().strip() if BACKEND_MARKER.exists() else ""

    if exe.exists() and _llama_server_usable(exe) and marker_backend in LLAMA_BACKEND_FILES:
        append_startup_event("portable.llama_server.exists", path=str(exe), backend=marker_backend)
        log_event(logger, "portable.llama_server.exists", path=str(exe), backend=marker_backend)
        return str(exe), marker_backend

    if exe.exists() and _llama_server_usable(exe) and not marker_backend:
        # Legacy install (pre-backend-selection). Keep working as CPU; user can
        # delete bin/ to upgrade.
        BACKEND_MARKER.write_text("cpu")
        append_startup_event("portable.llama_server.legacy_marked_cpu", path=str(exe))
        log_event(logger, "portable.llama_server.legacy_marked_cpu", path=str(exe))
        return str(exe), "cpu"

    if exe.exists():
        append_startup_event("portable.llama_server.incomplete", path=str(exe))
        log_event(logger, "portable.llama_server.incomplete", path=str(exe))

    BIN_DIR.mkdir(exist_ok=True)
    append_startup_event("portable.llama_server.prepare", bin_dir=str(BIN_DIR))
    log_event(logger, "portable.llama_server.prepare", bin_dir=str(BIN_DIR))

    detected = detect_gpu_vendor()
    backend = prompt_backend_choice(detected)

    zip_name = LLAMA_BACKEND_FILES[backend]
    zip_url = f"{LLAMA_RELEASE_BASE}/{zip_name}"
    step(2, 3, f"Downloading llama-server ({LLAMA_TAG}, {backend}); this happens only once ...")
    print(f"      URL: {zip_url}")

    zip_path = BIN_DIR / zip_name
    _download_with_progress(zip_url, zip_path)
    print("      Extracting llama-server.exe ...")
    append_startup_event("portable.llama_server.extract.start", archive=str(zip_path), backend=backend)
    try:
        _extract_runtime_zip(zip_path, require_server=True)
    finally:
        zip_path.unlink(missing_ok=True)

    if backend == "cuda":
        rt_url = f"{LLAMA_RELEASE_BASE}/{LLAMA_CUDA_RUNTIME_FILE}"
        rt_path = BIN_DIR / LLAMA_CUDA_RUNTIME_FILE
        print("      Downloading CUDA runtime DLLs ...")
        print(f"      URL: {rt_url}")
        _download_with_progress(rt_url, rt_path)
        try:
            _extract_runtime_zip(rt_path, require_server=False)
        finally:
            rt_path.unlink(missing_ok=True)

    if not _llama_server_usable(exe):
        hint = (
            "  The CUDA runtime DLLs may be missing or your NVIDIA driver is too old."
            if backend == "cuda" else
            "  A required runtime DLL may be missing."
        )
        raise RuntimeError(
            "llama-server.exe was extracted, but Windows still cannot start it.\n"
            f"{hint}\n"
            f"  Check: {BIN_DIR}\n"
            "  To pick a different backend, delete the bin/ folder and re-run."
        )

    BACKEND_MARKER.write_text(backend)
    append_startup_event("portable.backend.installed", backend=backend, path=str(exe))
    log_event(logger, "portable.backend.installed", backend=backend, path=str(exe))
    print(f"      Saved to {exe} ({backend})")
    return str(exe), backend


def _llama_server_usable(exe: Path) -> bool:
    """Return False when Windows loader cannot start llama-server, e.g. missing DLLs."""
    try:
        result = subprocess.run(
            [str(exe), "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        append_startup_event("portable.llama_server.usability_check.failed", path=str(exe), error=str(exc))
        log_event(logger, "portable.llama_server.usability_check.failed", path=str(exe), error=str(exc))
        return False
    ok = result.returncode == 0
    append_startup_event(
        "portable.llama_server.usability_check",
        path=str(exe),
        rc=result.returncode,
        ok=ok,
        stderr_tail=result.stderr[-500:],
    )
    log_event(
        logger,
        "portable.llama_server.usability_check",
        path=str(exe),
        rc=result.returncode,
        ok=ok,
        stderr_tail=result.stderr[-500:],
    )
    return ok


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
    cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps]
    append_startup_event("portable.file_dialog.start", title=title, initial_dir=init)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
    )
    selected = result.stdout.strip()
    append_startup_event("portable.file_dialog.done", title=title, rc=result.returncode, selected=bool(selected))
    if result.returncode != 0:
        log_event(logger, "portable.file_dialog.nonzero", title=title, rc=result.returncode, stderr=result.stderr[-1000:])
    return selected


def ensure_models(cfg: dict) -> tuple[dict, bool]:
    """Prompt user to pick model files if not already configured."""
    changed = False

    model_a_missing = not cfg.get("model_a_path") or not Path(cfg["model_a_path"]).exists()
    model_b_missing = not cfg.get("model_b_path") or not Path(cfg["model_b_path"]).exists()
    append_startup_event("portable.models.check", model_a_missing=model_a_missing, model_b_missing=model_b_missing)
    log_event(logger, "portable.models.check", model_a_missing=model_a_missing, model_b_missing=model_b_missing)

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
            append_startup_event("portable.models.model_a_selected", path=path)
            print(f"      Main model: {path}")
        else:
            append_startup_event("portable.models.model_a_skipped")
            print("      Skipped. Configure it later in the web UI.")

    if model_b_missing:
        print("  --> Select your PATCHER model (small GGUF model, e.g. Qwen3-1.7B).")
        path = _pick_file_powershell("Select PATCHER model - GGUF")
        if path:
            cfg["model_b_path"] = path
            changed = True
            append_startup_event("portable.models.model_b_selected", path=path)
            print(f"      Patcher model: {path}")
        else:
            append_startup_event("portable.models.model_b_skipped")
            print("      Skipped. Chat can run without Model B, but inline fixes will be disabled.")

    return cfg, changed


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            cfg = {**DEFAULT_CONFIG, **json.load(f)}
        append_startup_event("portable.config.loaded", path=str(CONFIG_FILE))
        log_event(logger, "portable.config.loaded", path=str(CONFIG_FILE))
        return cfg
    append_startup_event("portable.config.default_used", path=str(CONFIG_FILE))
    log_event(logger, "portable.config.default_used", path=str(CONFIG_FILE))
    return DEFAULT_CONFIG.copy()


def save_config(cfg: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)
    append_startup_event("portable.config.saved", path=str(CONFIG_FILE))
    log_event(logger, "portable.config.saved", path=str(CONFIG_FILE))


def launch_app():
    banner("Starting Token Saving Replay Agent ...")
    print(f"  Browser will open at {APP_URL}")
    print("  Press Ctrl+C in this window to stop the app and model servers.")
    print()

    cmd = [sys.executable, str(BASE_DIR / "main.py")]
    append_startup_event("portable.main.spawn.start", command=cmd, cwd=str(BASE_DIR), pid=os.getpid())
    log_event(logger, "portable.main.spawn.start", command=cmd, cwd=str(BASE_DIR), pid=os.getpid())
    proc = subprocess.Popen(cmd)
    append_startup_event("portable.main.spawn.done", child_pid=proc.pid)
    log_event(logger, "portable.main.spawn.done", child_pid=proc.pid)

    time.sleep(2)
    append_startup_event("portable.browser.open", url=APP_URL)
    webbrowser.open(APP_URL)

    try:
        proc.wait()
        append_startup_event("portable.main.exited", child_pid=proc.pid, rc=proc.returncode)
        log_event(logger, "portable.main.exited", child_pid=proc.pid, rc=proc.returncode)
    except KeyboardInterrupt:
        print("\n  Stopping ...")
        append_startup_event("portable.main.keyboard_interrupt", child_pid=proc.pid)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            append_startup_event("portable.main.kill_after_timeout", child_pid=proc.pid)
            proc.kill()


def main():
    append_startup_event("portable.enter", executable=sys.executable, argv=sys.argv, cwd=str(Path.cwd()))
    log_event(logger, "portable.enter", executable=sys.executable, argv=sys.argv, cwd=str(Path.cwd()))
    banner("Setup")
    print()

    try:
        ensure_deps()
        llama_exe, llama_backend = ensure_llama_server()
        append_startup_event("portable.llama_server.ready", path=llama_exe, backend=llama_backend)

        cfg = load_config()
        cfg["llama_server_path"] = llama_exe
        cfg["llama_backend"] = llama_backend
        cfg, _ = ensure_models(cfg)
        save_config(cfg)

        launch_app()
    except KeyboardInterrupt:
        append_startup_event("portable.cancelled")
        print("\n  Cancelled.")
        sys.exit(0)
    except Exception as exc:
        append_startup_event("portable.failed", error=str(exc))
        log_error(logger, "portable.failed", exc)
        print(f"\n  ERROR: {exc}")
        input("\n  Press Enter to close ...")
        sys.exit(1)


if __name__ == "__main__":
    main()
