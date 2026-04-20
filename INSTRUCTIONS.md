# Installation & Usage Guide

> **Windows users:** skip this file — `start.bat` handles everything automatically.  
> This guide covers manual setup for Linux, macOS, and Windows power users.

---

## Contents

1. [Requirements](#1-requirements)
2. [Install the app](#2-install-the-app)
3. [Get llama-server](#3-get-llama-server)
4. [Get model files](#4-get-model-files)
5. [Launch](#5-launch)
6. [Launcher tab](#6-launcher-tab)
7. [Profile tab](#7-profile-tab)
8. [Chat tab](#8-chat-tab)
9. [Keyboard shortcuts](#9-keyboard-shortcuts)
10. [Troubleshooting](#10-troubleshooting)
11. [File layout](#11-file-layout)
12. [Recompiling TypeScript](#12-recompiling-typescript-optional)

---

## 1. Requirements

| Requirement | Notes |
|-------------|-------|
| Python 3.10+ | System Python is fine |
| `llama-server` binary | From [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) |
| One or two `.gguf` model files | See §4 for recommendations |
| A modern browser | Chrome, Edge, Firefox |

No Node.js. No npm. No Docker. No installer.

---

## 2. Install the app

```bash
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
pip install -r requirements.txt
```

---

## 3. Get llama-server

### Windows (manual)

Download a pre-built release from [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases).

Recommended build for b8855: `llama-b8855-bin-win-cpu-x64.zip`  
Extract it anywhere (e.g. `D:\llama\`). The binary is `llama-server.exe`.

Want GPU acceleration? Use the CUDA or Vulkan build instead:
- `llama-b8855-bin-win-cuda-cu12.4-x64.zip` — requires CUDA 12.4 runtime
- `llama-b8855-bin-win-vulkan-x64.zip` — requires Vulkan runtime

### Linux / macOS

Build from source:

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DLLAMA_CURL=ON
cmake --build build --config Release -j$(nproc)
# binary is at build/bin/llama-server
```

Or download a pre-built binary from the releases page if one is available for your platform.

You do **not** need `llama-server` in the project folder — you point to it in the Launcher tab.

---

## 4. Get model files

You need `.gguf` quantized model files.

**Where to download:**
- [bartowski's quants](https://huggingface.co/bartowski) — well-maintained, wide selection
- [unsloth's quants](https://huggingface.co/unsloth) — optimised quantizations
- [Hugging Face GGUF search](https://huggingface.co/models?search=gguf) — everything else

**Main Model (A) — the thinker.** Use anything 7B or larger:
- Qwen3-14B, Qwen2.5-32B, DeepSeek-R1-14B, Mistral-7B, LLaMA-3.1-8B
- Q5_K_M or Q8_0 for best output quality

**Patcher Model (B) — the fixer.** Use the smallest, fastest model you have:
- Qwen3-1.7B, Qwen2.5-1.5B, SmolLM2-1.7B, Llama-3.2-1B
- Q4 or Q5 is fine — accuracy matters less than speed here

> **Thinking models (Qwen3, DeepSeek-R1, etc.) work for both roles.**  
> The agent sends `/no_think` to suppress chain-of-thought on the patcher.  
> If the model ignores it, the answer is extracted from `reasoning_content` automatically.

---

## 5. Launch

```bash
python main.py
```

Browser opens at `http://localhost:7860`. You'll land on the **Launcher** tab.

---

## 6. Launcher tab

This is where you start and stop your models.

### Step-by-step

**1. Set the llama-server binary**

Click **Browse…** next to "llama-server binary" and select:
- Windows: `llama-server.exe`
- Linux/macOS: `llama-server` (no extension)

**2. Configure Main Model (A)**

| Setting | Default | Notes |
|---------|---------|-------|
| Model path | — | Browse to your main `.gguf` |
| Extra args | `-c 16384 -ngl 99 -t 6 --no-mmap --flash-attn on` | See arg reference below |
| Port | `8080` | Change if in use |

**3. Configure Patcher Model (B)**

Check **"Enable patcher model (Model B)"**, then:

| Setting | Default | Notes |
|---------|---------|-------|
| Model path | — | Browse to your small/fast `.gguf` |
| Extra args | `-c 4096 -ngl 0 -t 4` | CPU-only is fine for 1–3B models |
| Port | `8081` | Change if in use |

**4. Set Host**

Default `0.0.0.0` serves on all interfaces. Use `127.0.0.1` to restrict to localhost.

**5. Click Start**

Status indicator: 🟡 loading → 🟢 healthy (responding to `/v1/models`)

Watch the log console for real-time llama-server output. Large models can take 10–60 s to load.

**To stop:** click **Stop All** — both processes are terminated.

### llama-server arg reference

| Arg | Effect |
|-----|--------|
| `-c N` | Context length in tokens. Reduce if you run out of VRAM. |
| `-ngl N` | GPU layers to offload. `0` = CPU only. `99` = offload everything. |
| `-t N` | CPU threads. Match your physical core count. |
| `--no-mmap` | Disables memory-mapped file loading. More stable on Windows. |
| `--flash-attn on` | Faster attention computation. Remove if your GPU doesn't support it. |

---

## 7. Profile tab

Fill in your environment once. These fields become a system prompt injected into every request — the main model knows your full setup before you type anything.

| Field | Example value |
|-------|--------------|
| Shell | `PowerShell` |
| OS | `Windows 11` |
| Python version | `3.12` |
| Package manager | `uv` |
| Naming convention | `snake_case for Python, kebab-case for folders` |
| Custom rules | `always use uv, never pip` / `prefer async/await` / `use pathlib not os.path` |

All fields **auto-save as you type** (localStorage). No save button needed.

---

## 8. Chat tab

### Sending messages

- `Enter` — send
- `Shift+Enter` — new line
- Responses stream in real time from the main model

### Automatic Step Extractor

Every response is parsed into addressable blocks as it arrives:
- Section headers and numbered list items → `step-1`, `step-2`, …
- Code blocks → `code-block-1`, `code-block-2`, …

### Automatic Inline Patcher

After streaming completes, every command block (`bash`, `sh`, `cmd`, `powershell`, `batch`, `zsh`, `fish`) is silently sent to the patcher model.

If a command doesn't match your profile, it's rewritten in place:
- A green badge appears: `✓ auto-translated → powershell`
- Click **↶ undo** to restore the original at any time

### Error Popup

When a command fails in your terminal:

1. Click **⚠ Problem?** on that code block
2. The popup shows the block content
3. Paste your terminal error (type it, or click **📋 Paste from clipboard**)
4. Click **Ask patcher**
5. The patcher responds with a proposed fix and explanation
6. Click **✓ Apply to block** to replace the block content

Cost: ~200–400 tokens from the small model. Main conversation context is never modified.

### Copy button

Every code block has a **Copy** button. Click to copy the (potentially patched) command to clipboard.

### Conversation persistence

Chat history is stored in `sessionStorage` — survives page refresh, cleared when you close the tab.  
Click **Clear** to start a fresh session manually.

---

## 9. Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Esc` | Close error popup |

---

## 10. Troubleshooting

**"llama-server binary not found"**  
→ Go to Launcher tab → Browse… → select your `llama-server.exe` (or `llama-server`).

**"File not found: …gguf"**  
→ The model path is wrong or the drive isn't mounted. Re-browse to the file.

**"Port 8080 is already in use"**  
→ Change the port in the Launcher tab, or find and stop the process using that port:
```powershell
# Windows — find what's using port 8080
netstat -ano | findstr :8080
```

**Status stays yellow (Starting…) indefinitely**  
→ The model is still loading. This is normal for large models (10–60 s). Watch the log console — if you see a memory error or crash, check VRAM.

**Red VRAM error badge**  
Options, in order of impact:
1. Reduce `-ngl 99` to a lower number (offload fewer layers to GPU)
2. Switch to a more quantized version of the model (Q4 instead of Q8)
3. Reduce `-c 16384` (shorter context = less VRAM)
4. Add `-ngl 0` to run fully on CPU

**Patcher doesn't run after responses**  
→ Check: (a) Model B status is 🟢, (b) "Enable patcher model" is checked in Launcher.

**"Patcher model (B) is not running"**  
→ Return to Launcher tab, add a Model B path, click Start.

**"Main Model (A) is not running"**  
→ Start Model A from the Launcher tab first.

**Patcher rewrites things it shouldn't**  
→ Add explicit rules to your Profile tab — e.g. "do not rewrite git commands" or "leave curl commands as-is".

---

## 11. File layout

```
token-saving-replay-agent/
│
├── main.py                  # FastAPI backend — serves UI + proxies to llama-server
├── portable_launcher.py     # Windows launcher logic (called by start.bat)
├── start.bat                # Windows zero-install entry point
│
├── static/
│   ├── index.html           # Single-page app (Launcher / Chat / Profile tabs)
│   ├── app.ts               # TypeScript source
│   └── app.js               # Compiled JS — committed, no build step for users
│
├── requirements.txt         # Python dependencies
├── config.json              # Last-used settings — auto-written, safe to edit
│
├── python/                  # Portable Python (Windows only, created by start.bat)
└── bin/                     # llama-server.exe (Windows only, created by start.bat)
```

`config.json` is written automatically when you start models. You can edit it manually — it's plain JSON.

---

## 12. Recompiling TypeScript (optional)

Only needed if you modify `static/app.ts`. Requires Node.js.

```bash
npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts
```

End users never need this — `app.js` is already compiled and committed.
