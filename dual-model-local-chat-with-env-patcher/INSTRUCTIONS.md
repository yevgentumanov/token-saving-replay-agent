# Installation and Usage Guide

This guide covers the browser alpha. The VS Code extension is experimental.

## 1. Requirements

| Requirement | Notes |
|---|---|
| Python 3.10+ | Needed for manual cross-platform setup |
| `llama-server` | Download or build from llama.cpp |
| GGUF model files | One for Model A, optional smaller one for Model B |
| Modern browser | Chrome, Edge, Firefox, or similar |

Windows users can run `start.bat` for the portable setup path.

## 2. Manual Install

```bash
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
pip install -r requirements.txt
python main.py
```

Open `http://localhost:7860`.

## 3. Get llama-server

### Windows

Download a llama.cpp release archive and extract `llama-server.exe`.

Recommended CPU build for the portable launcher:

```text
llama-b8855-bin-win-cpu-x64.zip
```

CUDA and Vulkan builds can also be used if your machine supports them.

### Linux / macOS

Build llama.cpp from source:

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DLLAMA_CURL=ON
cmake --build build --config Release -j$(nproc)
```

The binary is usually in `build/bin/llama-server`.

## 4. Configure the Launcher

In the Launcher tab:

1. Choose the provider for Model A.
2. For local mode, select the Model A `.gguf` path.
3. For cloud mode, select a LiteLLM model and enter an API key.
4. Optionally enable Model B and configure a smaller local or cloud model.
5. Set the `llama-server` binary path for local models.
6. Click Start.

Model A is required for chat. Model B is optional; without it, inline patching,
error-popup fixes, and consolidation are disabled with a visible warning.

## 5. Profile Tab

Fill in your environment:

- shell
- OS
- Python version
- package manager
- naming rules
- custom rules

The profile is saved in `localStorage` and added to every Model A request.
The patcher uses it to rewrite command blocks for your shell.

## 6. Chat Tab

- Press Enter to send.
- Press Shift+Enter for a newline.
- Command code blocks get Copy and Problem buttons.
- If Model B is healthy, shell command blocks are checked and patched.
- Applied patches can be undone.
- Consolidation Pass summarizes patch changes for the next turn.

## 7. Diagnostics

The Launcher tab has a Diagnostics button. It returns safe JSON for issues:

- app version
- Python version
- platform
- Model A/B provider, health, running state, port
- whether configured local paths exist

It does not include API keys, prompts, chat history, or raw model paths.

## 8. Config Files

- `config.json` is local runtime state and is ignored by git.
- `config.example.json` shows the expected shape.
- Cloud API keys are stored locally if you use cloud providers.

## 9. Troubleshooting

### Main Model is not running

Start Model A from the Launcher tab. For local mode, check that the GGUF path and
`llama-server` path exist.

### Patcher is offline

Chat still works. Inline fixes and consolidation are disabled until Model B is
started and healthy.

### Port already in use

Change the port in the Launcher tab or stop the process using that port.

Windows:

```powershell
netstat -ano | findstr :8080
```

### VRAM error

Try these in order:

1. Lower `-ngl`.
2. Use a smaller or more quantized model.
3. Lower `-c`.
4. Use CPU mode with `-ngl 0`.

### Cloud provider fails

Check that the API key is present, the model ID is valid for LiteLLM, and your
network can reach the provider.

## 10. Recompile TypeScript

Only needed after editing `static/app.ts`:

```bash
npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts
```

## 11. Run Alpha Tests

```bash
npm install
npm run test:alpha
```

The alpha suite runs backend/config/consolidation tests plus Playwright browser
smoke tests. The browser tests start `python main.py` with `LLAMA_NO_BROWSER=1`
and verify the Launcher, Diagnostics, and offline Chat warning.
