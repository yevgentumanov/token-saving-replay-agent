# main.py
import asyncio
import atexit
import errno
import json
import platform
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Optional

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import consolidation
from consolidation import PatchRecord, run_consolidation_pass
from llm_clients import make_client

BASE_DIR = Path(__file__).parent
CONFIG_FILE = BASE_DIR / "config.json"
STATIC_DIR = BASE_DIR / "static"

DEFAULT_CONFIG = {
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


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    return DEFAULT_CONFIG.copy()


def save_config(data: dict):
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)


def find_llama_server() -> str:
    found = shutil.which("llama-server")
    if found:
        return found
    return "llama-server.exe" if platform.system() == "Windows" else "llama-server"


# --- Global state ---
class State:
    proc_a: Optional[subprocess.Popen] = None
    proc_b: Optional[subprocess.Popen] = None
    healthy_a: bool = False
    healthy_b: bool = False
    vram_a: bool = False
    vram_b: bool = False
    port_a: int = 8080
    port_b: int = 8081
    log_queue: asyncio.Queue = None
    loop: asyncio.AbstractEventLoop = None
    provider_a: str = "local"
    provider_b: str = "local"
    client_a: Optional[object] = None  # BaseLLMClient
    client_b: Optional[object] = None  # BaseLLMClient

    @classmethod
    def alive(cls, proc) -> bool:
        return proc is not None and proc.poll() is None


state = State()


def _read_stream(stream, label: str, vram_flag: str, proc_ref: list):
    try:
        for line in iter(stream.readline, b""):
            text = line.decode("utf-8", errors="replace").rstrip()
            if not text:
                continue
            low = text.lower()
            if "out of memory" in low or ("vram" in low and "error" in low):
                setattr(state, vram_flag, True)
            tagged = f"[{label}] {text}"
            if state.loop and state.log_queue and not state.log_queue.full():
                asyncio.run_coroutine_threadsafe(state.log_queue.put(tagged), state.loop)
    except Exception:
        pass
    finally:
        proc = proc_ref[0] if proc_ref else None
        code = proc.poll() if proc else None
        if code is not None and code != 0:
            msg = f"[{label}] ⚠ Process exited with code {code} — check your arguments (e.g. -ngl value) or model path"
            if state.loop and state.log_queue and not state.log_queue.full():
                asyncio.run_coroutine_threadsafe(state.log_queue.put(msg), state.loop)


def _kill(proc: Optional[subprocess.Popen]):
    if proc and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def stop_all():
    _kill(state.proc_a)
    _kill(state.proc_b)
    state.proc_a = state.proc_b = None
    state.healthy_a = state.healthy_b = False
    state.vram_a = state.vram_b = False
    state.client_a = state.client_b = None
    state.provider_a = state.provider_b = "local"


atexit.register(stop_all)
if platform.system() != "Windows":
    signal.signal(signal.SIGTERM, lambda *_: (stop_all(), sys.exit(0)))


async def _health(flag: str, proc_attr: str, port_attr: str, provider_attr: str, client_attr: str):
    async with httpx.AsyncClient(timeout=3.0) as client:
        while True:
            await asyncio.sleep(4)
            if getattr(state, provider_attr) != "local":
                # Cloud provider: ask the client for a health check
                llm_client = getattr(state, client_attr)
                if llm_client is not None:
                    try:
                        result = await llm_client.health_check()
                    except Exception:
                        result = False
                else:
                    result = False
                setattr(state, flag, result)
                continue
            # Local provider: check if the subprocess is alive then probe /v1/models
            proc = getattr(state, proc_attr)
            if not state.alive(proc):
                setattr(state, flag, False)
                continue
            port = getattr(state, port_attr)
            try:
                r = await client.get(f"http://127.0.0.1:{port}/v1/models")
                setattr(state, flag, r.status_code == 200)
            except Exception:
                setattr(state, flag, False)


def _launch(model_path: str, args: str, host: str, port: int, llama_bin: str):
    cmd = [llama_bin, "--model", model_path, "--host", host, "--port", str(port)]
    if args.strip():
        cmd += shlex.split(args)
    try:
        return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
    except FileNotFoundError:
        raise HTTPException(400, f"llama-server binary not found: {llama_bin}")
    except OSError as e:
        if e.errno == errno.EADDRINUSE or "10048" in str(e):
            raise HTTPException(400, f"Port {port} is already in use — change the port or stop the conflicting process")
        raise HTTPException(400, f"Failed to start: {e}")


# --- FastAPI ---
app = FastAPI()

# Allow VS Code webview panels (vscode-webview://*) and local browser dev
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"(vscode-webview://[a-z0-9\-]+|http://localhost:\d+|http://127\.0\.0\.1:\d+)",
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=False,
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
async def startup():
    state.loop = asyncio.get_event_loop()
    state.log_queue = asyncio.Queue(maxsize=1000)
    asyncio.create_task(_health("healthy_a", "proc_a", "port_a", "provider_a", "client_a"))
    asyncio.create_task(_health("healthy_b", "proc_b", "port_b", "provider_b", "client_b"))
    threading.Timer(1.2, lambda: webbrowser.open("http://localhost:7860")).start()


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


class ModelConfig(BaseModel):
    path: str = ""
    args: str = ""
    port: int = 8080
    provider: str = "local"
    api_key: str = ""
    cloud_model: str = ""


class StartRequest(BaseModel):
    model_a: ModelConfig
    model_b: Optional[ModelConfig] = None
    host: str = "0.0.0.0"
    llama_server_path: str = ""


def _model_ready(which: str) -> bool:
    provider = getattr(state, f"provider_{which}")
    if provider == "local":
        return state.alive(getattr(state, f"proc_{which}"))
    return getattr(state, f"client_{which}") is not None


@app.post("/api/start")
async def api_start(req: StartRequest):
    already = (
        state.alive(state.proc_a) or state.alive(state.proc_b)
        or state.client_a is not None or state.client_b is not None
    )
    if already:
        raise HTTPException(400, "Already running — stop first")

    cfg = load_config()
    llama_bin = req.llama_server_path.strip() or cfg.get("llama_server_path") or find_llama_server()

    # Validate model A
    if req.model_a.provider == "local":
        if not req.model_a.path or not Path(req.model_a.path).exists():
            raise HTTPException(400, f"Model A not found: {req.model_a.path}")
    else:
        if not req.model_a.api_key.strip():
            raise HTTPException(400, "Model A: API key is required for cloud providers")
        if not req.model_a.cloud_model.strip():
            raise HTTPException(400, "Model A: cloud model ID is required")

    # Validate model B (if present)
    if req.model_b:
        if req.model_b.provider == "local":
            if not req.model_b.path or not Path(req.model_b.path).exists():
                raise HTTPException(400, f"Model B not found: {req.model_b.path}")
        else:
            if not req.model_b.api_key.strip():
                raise HTTPException(400, "Model B: API key is required for cloud providers")
            if not req.model_b.cloud_model.strip():
                raise HTTPException(400, "Model B: cloud model ID is required")

    # Port collision check only between two local models
    if (
        req.model_b
        and req.model_a.provider == "local"
        and req.model_b.provider == "local"
        and req.model_a.port == req.model_b.port
    ):
        raise HTTPException(400, f"Model A and B cannot use the same port ({req.model_a.port})")

    state.vram_a = state.vram_b = False

    # --- Launch Model A ---
    state.provider_a = req.model_a.provider
    state.client_a = make_client(
        req.model_a.provider,
        port=req.model_a.port,
        model=req.model_a.cloud_model,
        api_key=req.model_a.api_key,
    )

    pid_a = None
    if req.model_a.provider == "local":
        state.port_a = req.model_a.port
        proc_a = _launch(req.model_a.path, req.model_a.args, req.host, req.model_a.port, llama_bin)
        state.proc_a = proc_a
        pid_a = proc_a.pid
        threading.Thread(target=_read_stream, args=(proc_a.stdout, "A", "vram_a", [proc_a]), daemon=True).start()
    else:
        state.healthy_a = await state.client_a.health_check()
        log_msg = f"[A] Connected to {req.model_a.provider} — {req.model_a.cloud_model}"
        if state.loop and state.log_queue and not state.log_queue.full():
            await state.log_queue.put(log_msg)

    # --- Launch Model B ---
    pid_b = None
    if req.model_b:
        state.provider_b = req.model_b.provider
        state.client_b = make_client(
            req.model_b.provider,
            port=req.model_b.port,
            model=req.model_b.cloud_model,
            api_key=req.model_b.api_key,
        )

        if req.model_b.provider == "local":
            state.port_b = req.model_b.port
            proc_b = _launch(req.model_b.path, req.model_b.args, req.host, req.model_b.port, llama_bin)
            state.proc_b = proc_b
            pid_b = proc_b.pid
            threading.Thread(target=_read_stream, args=(proc_b.stdout, "B", "vram_b", [proc_b]), daemon=True).start()
        else:
            state.healthy_b = await state.client_b.health_check()
            log_msg = f"[B] Connected to {req.model_b.provider} — {req.model_b.cloud_model}"
            if state.loop and state.log_queue and not state.log_queue.full():
                await state.log_queue.put(log_msg)

    cfg.update(
        model_a_path=req.model_a.path,
        model_a_args=req.model_a.args,
        model_a_port=req.model_a.port,
        model_b_path=req.model_b.path if req.model_b else "",
        model_b_args=req.model_b.args if req.model_b else cfg.get("model_b_args", ""),
        model_b_port=req.model_b.port if req.model_b else cfg.get("model_b_port", 8081),
        host=req.host,
        llama_server_path=llama_bin,
        model_a_provider=req.model_a.provider,
        model_a_api_key=req.model_a.api_key,
        model_a_cloud_model=req.model_a.cloud_model,
        model_b_provider=req.model_b.provider if req.model_b else cfg.get("model_b_provider", "local"),
        model_b_api_key=req.model_b.api_key if req.model_b else cfg.get("model_b_api_key", ""),
        model_b_cloud_model=req.model_b.cloud_model if req.model_b else cfg.get("model_b_cloud_model", ""),
    )
    save_config(cfg)

    return {"ok": True, "pid_a": pid_a, "pid_b": pid_b}


@app.post("/api/stop")
async def api_stop():
    stop_all()
    return {"ok": True}


@app.get("/api/status")
async def api_status():
    running_a = state.alive(state.proc_a) if state.provider_a == "local" else state.client_a is not None
    running_b = state.alive(state.proc_b) if state.provider_b == "local" else state.client_b is not None
    return {
        "a": {
            "running": running_a,
            "healthy": state.healthy_a,
            "vram_error": state.vram_a,
            "pid": state.proc_a.pid if state.alive(state.proc_a) else None,
            "port": state.port_a,
            "provider": state.provider_a,
        },
        "b": {
            "running": running_b,
            "healthy": state.healthy_b,
            "vram_error": state.vram_b,
            "pid": state.proc_b.pid if state.alive(state.proc_b) else None,
            "port": state.port_b,
            "provider": state.provider_b,
        },
    }


@app.get("/api/config")
async def api_get_config():
    return load_config()


@app.get("/api/open-file-dialog")
async def api_open_file_dialog(type: str = "model"):
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        if type == "binary":
            filetypes = [("Executables", "*.exe"), ("All files", "*.*")]
            title = "Select llama-server executable"
        else:
            filetypes = [("GGUF models", "*.gguf"), ("All files", "*.*")]
            title = "Select GGUF model"
        path = filedialog.askopenfilename(title=title, filetypes=filetypes)
        root.destroy()
        return {"path": path or ""}
    except Exception as e:
        raise HTTPException(500, f"File dialog failed: {e}")


@app.post("/api/chat/main")
async def chat_main(request: Request):
    if not _model_ready("a"):
        raise HTTPException(400, "Main model (A) is not running or not configured")
    body = await request.json()

    async def event_stream():
        try:
            async for chunk in state.client_a.chat_stream(
                messages=body.get("messages", []),
                temperature=body.get("temperature", 0.7),
                max_tokens=body.get("max_tokens", 4096),
            ):
                yield chunk
        except Exception as e:
            yield f'data: {{"error": "{str(e)}"}}\n\n'.encode()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/chat/patcher")
async def chat_patcher(request: Request):
    if not _model_ready("b"):
        raise HTTPException(400, "Patcher model (B) is not running — start it first")
    body = await request.json()
    try:
        result = await state.client_b.chat_complete(
            messages=body.get("messages", []),
            temperature=body.get("temperature", 0.1),
            max_tokens=body.get("max_tokens", 1024),
        )
        return result
    except Exception as e:
        raise HTTPException(500, f"Patcher request failed: {e}")


class ConsolidationRequestBody(BaseModel):
    patches: list[PatchRecord]


class ConsolidationConfigBody(BaseModel):
    patch_threshold: Optional[int] = None
    token_threshold: Optional[int] = None


@app.post("/api/consolidation")
async def api_consolidation(req: ConsolidationRequestBody):
    """
    Phase 2.5 — Consolidation Pass.
    Called by the frontend after all inline patches for a turn are done.
    Automatically selects full vs lightweight mode based on smart thresholds,
    then returns the result for injection into the next main-model system prompt.
    """
    if not _model_ready("b"):
        raise HTTPException(400, "Patcher model (B) is not running — cannot run Consolidation Pass")
    if not req.patches:
        return {"changed_steps": [], "summary": "", "state_delta": "", "patch_count": 0, "mode": "lightweight"}
    result = await run_consolidation_pass(state.client_b, req.patches)
    if result is None:
        raise HTTPException(500, "Consolidation Pass failed — check patcher logs")
    return result.model_dump()


@app.get("/api/consolidation/config")
async def api_consolidation_config_get():
    """Return current smart-threshold values."""
    return {
        "patch_threshold": consolidation.CONSOLIDATION_PATCH_THRESHOLD,
        "token_threshold": consolidation.CONSOLIDATION_TOKEN_THRESHOLD,
    }


@app.post("/api/consolidation/config")
async def api_consolidation_config_set(body: ConsolidationConfigBody):
    """
    Update smart-threshold values at runtime (no restart needed).
    Only the supplied fields are changed.
    """
    if body.patch_threshold is not None:
        if body.patch_threshold < 1:
            raise HTTPException(400, "patch_threshold must be >= 1")
        consolidation.CONSOLIDATION_PATCH_THRESHOLD = body.patch_threshold
    if body.token_threshold is not None:
        if body.token_threshold < 1:
            raise HTTPException(400, "token_threshold must be >= 1")
        consolidation.CONSOLIDATION_TOKEN_THRESHOLD = body.token_threshold
    return {
        "patch_threshold": consolidation.CONSOLIDATION_PATCH_THRESHOLD,
        "token_threshold": consolidation.CONSOLIDATION_TOKEN_THRESHOLD,
    }


@app.websocket("/ws/logs")
async def ws_logs(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            try:
                line = await asyncio.wait_for(state.log_queue.get(), timeout=15.0)
                await ws.send_text(line)
            except asyncio.TimeoutError:
                await ws.send_text("\x00")
    except (WebSocketDisconnect, Exception):
        pass


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="warning")
