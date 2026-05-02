# Token Saving Replay Agent

Alpha: `v0.1.0-alpha`

Token Saving Replay Agent is a local-first browser chat for running a main LLM
beside a smaller patcher LLM. The main model does the reasoning. The patcher
model fixes shell commands for your actual environment, handles command errors,
and summarizes those patches back into the next turn.

The first alpha product is the browser app at `http://localhost:7860`.
The VS Code extension now lives in a separate local repository:
`C:\Users\Euu\Desktop\Projects\extension-token-saving-elephant-memory`.

## Quick Start

### Cross-platform manual setup

Requirements:

- Python 3.10+
- A `llama-server` binary from llama.cpp
- One GGUF model for Model A
- Optional: a smaller GGUF model for Model B

```bash
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
pip install -r requirements.txt
python main.py
```

Open `http://localhost:7860`, then configure the Launcher tab:

- `llama-server` binary path
- Model A path or cloud provider
- Optional Model B path or cloud provider
- Host and ports

### Windows zero-install path

Windows users can run:

```bat
start.bat
```

On first run it downloads portable Python, installs dependencies, detects your
GPU and asks which `llama-server` backend to download (CUDA / Vulkan / CPU),
asks for model files, and opens the app. To switch backend later, delete the
`bin/` folder and re-run.

## What Works in Alpha

- Browser Launcher for Model A and optional Model B
- Local llama.cpp models via `llama-server`
- Optional cloud providers through LiteLLM: OpenAI, Anthropic, Groq
- Streaming chat from Model A
- Environment Profile injected into chat turns
- Inline Patcher for shell command blocks
- Error popup for fixing failed commands with Model B
- Consolidation Pass: Model B summarizes applied patches for the next Model A turn
- Safe diagnostics JSON for bug reports

If Model B is offline, chat still works with Model A. The UI shows a warning and
inline patching/consolidation are disabled until Model B is ready.

## Why Two Models?

Large models waste context on tiny environment fixes:

```text
Model A: pip install fastapi
User: I use uv and PowerShell. Here is the error...
Model A: uv add fastapi
```

The patcher model handles that small correction without sending the whole
conversation back through the main model. This keeps the main context cleaner and
reduces repeated micro-fix tokens.

## Local-First Notes

- `config.json` is local runtime state and is ignored by git.
- `config.example.json` documents the expected shape without secrets.
- API keys are stored locally when cloud providers are used.
- Browser markdown/sanitizer libraries are vendored in `static/vendor/`.

## Model Suggestions

Model A should be the strongest model your machine can run comfortably:

- Qwen3-14B
- Qwen2.5-32B
- DeepSeek-R1-14B
- Llama / Mistral / Gemma class models

Model B should be small and fast:

- Qwen3-1.7B
- Qwen2.5-1.5B
- SmolLM2-1.7B
- Llama-3.2-1B

Thinking models are supported. The app sends `/no_think` to patcher-style calls
and falls back to `reasoning_content` when needed.

## Architecture

```text
Browser http://localhost:7860
  FastAPI main.py
    /api/start          starts local llama-server processes or cloud clients
    /api/status         reports Model A/B health
    /api/chat/main      streams Model A responses
    /api/chat/patcher   one-shot Model B patcher calls
    /api/consolidation  summarizes applied patches
    /api/diagnostics    safe issue diagnostics, no secrets
    /ws/logs            streams local llama-server logs
```

Core files:

- `main.py` - FastAPI backend, process management, API routes
- `llm_clients.py` - local/cloud LLM abstraction
- `consolidation.py` - patch summary pass
- `static/index.html` and `static/app.ts` - browser UI
- `portable_launcher.py` and `start.bat` - Windows portable launcher

## Development

After editing `static/app.ts`, compile:

```bash
npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts
```

Useful checks:

```bash
python -m py_compile main.py llm_clients.py consolidation.py keeper.py portable_launcher.py
node --check static/app.js
```

Alpha test suite:

```bash
npm install
npm run test:alpha
```

`test:alpha` runs Python unit/smoke tests and a Playwright browser smoke test
against a temporary local `python main.py` server.

## Contributing

This alpha is intentionally small and practical. Good issues include:

- startup failures
- confusing model configuration
- patcher rewrites that are wrong
- missing diagnostics
- cross-platform install notes

Please include the Diagnostics output from the Launcher tab when filing bugs.
