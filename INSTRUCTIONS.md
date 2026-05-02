# Installation and Usage Guide

Version `0.1.0-alpha` — browser app at `http://localhost:7860`.

## 1. Requirements

| Requirement | Notes |
|---|---|
| Python 3.10+ | Cross-platform manual setup |
| `llama-server` | From llama.cpp — for local GGUF models |
| GGUF model files | One for Model A, optional smaller one for Model B |
| Modern browser | Chrome, Edge, Firefox, Safari |

Cloud providers (OpenAI, Anthropic, Groq) work without `llama-server` or GGUF files.

Windows users can skip everything above and just run `start.bat` — it handles
portable Python, GPU detection, and `llama-server` download automatically.

---

## 2. Install — Cross-Platform

```bash
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
pip install -r requirements.txt
python main.py
```

The server starts on `http://localhost:7860` and opens a browser tab automatically.

Dependencies: `fastapi`, `uvicorn[standard]`, `pydantic`, `websockets`, `httpx`, `litellm`.

---

## 3. Install — Windows Portable (`start.bat`)

Run `start.bat` from Explorer or a terminal. On first run it:

1. Downloads portable Python 3.12 into `python/` (no system Python needed)
2. Installs dependencies with `pip` into the portable environment
3. Detects your GPU (NVIDIA CUDA, AMD/Intel Vulkan, or CPU)
4. Downloads the matching `llama-server.exe` into `bin/`
5. Asks for GGUF model paths
6. Starts the app

To switch GPU backend, delete the `bin/` folder and re-run `start.bat`.
Everything stays local — nothing is installed system-wide.

---

## 4. Get `llama-server`

Only needed for local GGUF models. Skip if using cloud providers only.

### Windows (manual)

Download a release archive from llama.cpp and extract `llama-server.exe`.
The portable launcher handles this automatically.

### Linux / macOS

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DLLAMA_CURL=ON
cmake --build build --config Release -j$(nproc)
# binary at build/bin/llama-server
```

---

## 5. Launcher Tab

After opening the app, go to the **Launcher** tab to configure and start models.

### Model A (required for chat)

- **Provider**: `local` (GGUF via llama-server) or cloud (`openai`, `anthropic`, `groq`)
- **Local**: set the `.gguf` path and the `llama-server` binary path
- **Cloud**: set the LiteLLM model ID (e.g. `gpt-4o`, `claude-sonnet-4-5`) and API key
- **Args** (local only): default `"-c 16384 -ngl 99 -t 6 --no-mmap --flash-attn on"`
- **Port**: default `8080`

### Model B — Patcher (optional)

- Same provider options as Model A
- Intended to be a small, fast model
- Default args: `"-c 4096 -ngl 0 -t 4"` (CPU by default)
- Default port: `8081`

If Model B is offline, chat still works with Model A. Inline patching,
error-popup fixes, and consolidation are all disabled with a visible warning
until Model B is started and healthy.

### Starting / Stopping

Click **Start** to launch both models. Click **Stop** to shut them down.
Config is saved to `config.json` after each Start.

The health indicator next to each model updates every 4 seconds.

---

## 6. Profile Tab

Fill in your local environment once. This is injected as the system prompt on
every Model A chat turn and used by the patcher to rewrite commands correctly.

| Field | Example |
|---|---|
| Shell | `powershell`, `bash`, `zsh` |
| OS | `Windows 11`, `Ubuntu 24.04` |
| Python version | `3.12.3` |
| Package manager | `uv`, `pip`, `conda` |
| Custom rules | Any extra instructions for Model A |

The profile is stored in `localStorage` — it persists between sessions but
is never sent to the server and never stored in `config.json`.

Use **Detect Environment** to auto-fill shell, OS, Python version, and
available tools from the server's environment detection endpoint.

---

## 7. Chat Tab

### Sending messages

- **Enter** — send
- **Shift+Enter** — newline

### Multi-chat sidebar

The sidebar on the left manages multiple independent conversations. Each chat
has its own history and is isolated from the others. Use the **+** button to
create a new chat; click any entry to switch. Chats are stored in `localStorage`.

### Inline Patcher

After Model A responds, any shell command code blocks (`bash`, `cmd`,
`powershell`, `sh`, `zsh`, etc.) are automatically sent to Model B. The patcher
rewrites them for your environment (shell, OS, package manager) as defined in
your Profile.

- Patched blocks show a coloured badge indicating a change was made
- Each patched block has an **Undo** button to revert to the original
- Patching happens in parallel for all blocks in the response

### Consolidation Pass

Once all patches in a turn settle, Model B produces a structured JSON summary
of what was changed and why. This summary is injected into the system prompt of
the **next** Model A turn so Model A stays aware of environment-specific changes
without repeating them in the conversation.

Two modes depending on volume:
- **Full pass** — structured JSON with per-block `original`/`patched`/`reason` fields (≥ 8 patches or ≥ 12 000 estimated tokens)
- **Lightweight** — short prose summary (below both thresholds)

### Error popup

If a command fails, paste the stderr into the error popup. Model B returns a
targeted fix without replaying the whole conversation through Model A.

---

## 8. API Routes

All routes are served by the FastAPI backend at `http://localhost:7860`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/start` | Start Model A and/or B |
| POST | `/api/stop` | Stop all model processes |
| GET | `/api/status` | Health of both models (`a`/`b` keys) |
| GET | `/api/config` | Current config (no API keys) |
| GET | `/api/diagnostics` | Safe diagnostics JSON for bug reports |
| POST | `/api/chat/main` | SSE stream from Model A |
| POST | `/api/chat/patcher` | One-shot Model B patcher call |
| POST | `/api/consolidation` | Run consolidation pass on a patch list |
| GET | `/api/consolidation/config` | Read consolidation thresholds |
| POST | `/api/consolidation/config` | Update consolidation thresholds at runtime |
| GET | `/api/keeper/status` | Keeper session state |
| POST | `/api/keeper/review` | Submit a change for Keeper review |
| POST | `/api/keeper/reset` | Force a Keeper Hard Reset |
| GET | `/api/environment/detect` | Detect shell, OS, tools from server env |
| GET | `/api/logs/recent` | Last N lines from `app.log` |
| POST | `/api/log/frontend` | Receive a log event from the browser |
| WS | `/ws/logs` | Live llama-server stdout/stderr stream |

---

## 9. Config Files

- `config.json` — local runtime state, ignored by git. Created on first Start.
- `config.example.json` — documents the expected shape without secrets.

Config keys:

| Key | Default | Notes |
|---|---|---|
| `model_a_path` | `""` | Path to Model A GGUF |
| `model_a_args` | `"-c 16384 -ngl 99 -t 6 --no-mmap --flash-attn on"` | llama-server args |
| `model_a_port` | `8080` | |
| `model_a_provider` | `"local"` | `local` or cloud provider name |
| `model_a_cloud_model` | `""` | LiteLLM model ID |
| `model_a_api_key` | `""` | Stored locally, never committed |
| `model_b_path` | `""` | Path to Model B GGUF |
| `model_b_args` | `"-c 4096 -ngl 0 -t 4"` | |
| `model_b_port` | `8081` | |
| `model_b_provider` | `"local"` | |
| `model_b_cloud_model` | `""` | |
| `model_b_api_key` | `""` | |
| `llama_server_path` | `""` | Auto-detected from `bin/` or `PATH` |
| `llama_backend` | `"vulkan"` | `cuda`, `vulkan`, or `cpu` |
| `host` | `"0.0.0.0"` | Bind address for llama-server |
| `use_patcher` | `true` | Enable/disable Model B patcher |

---

## 10. Diagnostics

The **Diagnostics** button in the Launcher tab returns safe JSON for filing bug reports:

- App version, Python version, platform
- Model A/B provider, health status, running state, port
- Whether configured local paths actually exist on disk

It does not include API keys, prompts, chat history, or raw model paths.

---

## 11. Logs

Logs are written to `.replay/logs/` (not committed to git):

| File | Contents |
|---|---|
| `app.log` | All backend events — startup, requests, LLM calls, errors |
| `frontend.log` | Browser-side events sent via `/api/log/frontend` |
| `startup.log` | Early startup output before the rotating handler is ready |

Rotating handler: max 2 MB per file, 3 backups.

Live llama-server stdout/stderr is streamed over the WebSocket at `/ws/logs`
and shown in the Launcher tab's log panel.

Recent log lines are also accessible via `GET /api/logs/recent?lines=80`.

---

## 12. Concept Keeper

`keeper.py` implements a guardian that reviews proposed architectural changes
against `.replay/CONCEPT.md` — the project's immutable design manifesto.

The Keeper is invoked via `/api/keeper/review` with a plain-text description of
the proposed change. It returns a structured JSON verdict:

```json
{
  "status": "APPROVED | WARNING | REJECTED | HARD_RESET",
  "verdict": "one-sentence decision",
  "reasoning": "2-3 sentences referencing CONCEPT.md principles",
  "concept_drift": 0,
  "violated_principles": [],
  "turn": 1
}
```

Drift scale: 0–4 approved, 5–7 warning, 8–10 rejected.

`HARD_RESET` is returned when the Keeper detects context drift or session
exhaustion (> 20 review turns, or 2 consecutive high-drift reviews). After a
Hard Reset it re-reads `CONCEPT.md` and resets the turn counter.

Use `/api/keeper/reset` to force a reset manually.
The Keeper runs inside the same FastAPI process and uses Model B as its LLM.

---

## 13. Troubleshooting

### Model A is not running

Start it from the Launcher tab. For local mode, verify the GGUF path and
`llama-server` path both exist.

### Patcher is offline

Chat still works. Inline fixes and consolidation are disabled. Start Model B
from the Launcher when ready.

### Port already in use

Change the port in the Launcher tab, or kill the process holding it.

Windows:
```powershell
netstat -ano | findstr :8080
Stop-Process -Id <PID>
```

Linux/macOS:
```bash
lsof -ti :8080 | xargs kill
```

### VRAM error / OOM

Try in order:

1. Lower `-ngl` (fewer GPU layers)
2. Use a smaller or higher-quantization model (Q4 instead of Q8)
3. Lower `-c` (context window)
4. Full CPU with `-ngl 0`

### Cloud provider fails

- Verify the API key is correct and not expired
- Check the model ID is valid for LiteLLM (e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4-5`)
- Confirm your network can reach the provider endpoint

### Thinking model produces empty content

The app falls back to `reasoning_content` automatically. Send `/no_think` in
the system message (done automatically for patcher calls) to suppress thinking
tokens and get faster responses from Qwen3 and similar models.

---

## 14. Development

### Recompile TypeScript

After editing `static/app.ts`:

```bash
npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts
```

`static/app.js` is the compiled output that the browser loads. Both files are
committed; the TypeScript source is the authoritative version.

### Syntax check

```bash
python -m py_compile main.py llm_clients.py consolidation.py keeper.py portable_launcher.py app_logging.py
node --check static/app.js
```

### Run Python tests

```bash
pytest tests/
```

Covers: FastAPI endpoints, config load/save, consolidation logic, static assets,
portable launcher functions, server subprocess startup, full chain integration.
42 tests, ~10 seconds.

### Run full suite (Python + Playwright browser tests)

```bash
npm install
npx playwright install chromium
npm run test:alpha
```

`test:alpha` runs `python -m unittest discover` then `playwright test`, which
starts `python main.py` with `LLAMA_NO_BROWSER=1` and drives the Launcher,
Diagnostics, and offline Chat warning with a headless Chromium browser.
