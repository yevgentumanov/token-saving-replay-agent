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
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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


atexit.register(stop_all)
if platform.system() != "Windows":
    signal.signal(signal.SIGTERM, lambda *_: (stop_all(), sys.exit(0)))


async def _health(port_attr: str, flag: str):
    async with httpx.AsyncClient(timeout=3.0) as client:
        while True:
            await asyncio.sleep(4)
            proc = state.proc_a if flag == "healthy_a" else state.proc_b
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
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
async def startup():
    state.loop = asyncio.get_event_loop()
    state.log_queue = asyncio.Queue(maxsize=1000)
    asyncio.create_task(_health("port_a", "healthy_a"))
    asyncio.create_task(_health("port_b", "healthy_b"))
    threading.Timer(1.2, lambda: webbrowser.open("http://localhost:7860")).start()


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


class ModelConfig(BaseModel):
    path: str
    args: str = ""
    port: int = 8080


class StartRequest(BaseModel):
    model_a: ModelConfig
    model_b: Optional[ModelConfig] = None
    host: str = "0.0.0.0"
    llama_server_path: str = ""


@app.post("/api/start")
async def api_start(req: StartRequest):
    if state.alive(state.proc_a) or state.alive(state.proc_b):
        raise HTTPException(400, "Already running — stop first")

    cfg = load_config()
    llama_bin = req.llama_server_path.strip() or cfg.get("llama_server_path") or find_llama_server()

    # Validate files exist before launching anything
    if not Path(req.model_a.path).exists():
        raise HTTPException(400, f"Model A not found: {req.model_a.path}")
    if req.model_b and not Path(req.model_b.path).exists():
        raise HTTPException(400, f"Model B not found: {req.model_b.path}")
    if req.model_b and req.model_a.port == req.model_b.port:
        raise HTTPException(400, f"Model A and B cannot use the same port ({req.model_a.port})")

    state.port_a = req.model_a.port
    state.vram_a = state.vram_b = False

    proc_a = _launch(req.model_a.path, req.model_a.args, req.host, req.model_a.port, llama_bin)
    state.proc_a = proc_a
    threading.Thread(target=_read_stream, args=(proc_a.stdout, "A", "vram_a", [proc_a]), daemon=True).start()

    pid_b = None
    if req.model_b:
        state.port_b = req.model_b.port
        proc_b = _launch(req.model_b.path, req.model_b.args, req.host, req.model_b.port, llama_bin)
        state.proc_b = proc_b
        threading.Thread(target=_read_stream, args=(proc_b.stdout, "B", "vram_b", [proc_b]), daemon=True).start()
        pid_b = proc_b.pid

    cfg.update(
        model_a_path=req.model_a.path, model_a_args=req.model_a.args, model_a_port=req.model_a.port,
        model_b_path=req.model_b.path if req.model_b else "",
        model_b_args=req.model_b.args if req.model_b else cfg.get("model_b_args", ""),
        model_b_port=req.model_b.port if req.model_b else cfg.get("model_b_port", 8081),
        host=req.host, llama_server_path=llama_bin,
    )
    save_config(cfg)

    return {"ok": True, "pid_a": proc_a.pid, "pid_b": pid_b}


@app.post("/api/stop")
async def api_stop():
    stop_all()
    return {"ok": True}


@app.get("/api/status")
async def api_status():
    return {
        "a": {
            "running": state.alive(state.proc_a),
            "healthy": state.healthy_a,
            "vram_error": state.vram_a,
            "pid": state.proc_a.pid if state.alive(state.proc_a) else None,
            "port": state.port_a,
        },
        "b": {
            "running": state.alive(state.proc_b),
            "healthy": state.healthy_b,
            "vram_error": state.vram_b,
            "pid": state.proc_b.pid if state.alive(state.proc_b) else None,
            "port": state.port_b,
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
    if not state.alive(state.proc_a):
        raise HTTPException(400, "Main model (A) is not running")
    body = await request.json()
    body["stream"] = True
    port = state.port_a

    async def event_stream():
        async with httpx.AsyncClient(timeout=None) as client:
            try:
                async with client.stream(
                    "POST",
                    f"http://127.0.0.1:{port}/v1/chat/completions",
                    json=body,
                ) as response:
                    async for chunk in response.aiter_raw():
                        yield chunk
            except Exception as e:
                yield f"data: {{\"error\": \"{str(e)}\"}}\n\n".encode()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/chat/patcher")
async def chat_patcher(request: Request):
    if not state.alive(state.proc_b):
        raise HTTPException(400, "Patcher model (B) is not running — start it first")
    body = await request.json()
    body["stream"] = False
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            r = await client.post(
                f"http://127.0.0.1:{state.port_b}/v1/chat/completions",
                json=body,
            )
            return r.json()
        except Exception as e:
            raise HTTPException(500, f"Patcher request failed: {e}")


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
