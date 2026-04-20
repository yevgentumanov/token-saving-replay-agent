# Installation & Usage Guide

> **Windows users:** you don't need any of this — just run `start.bat` and it handles everything.  
> This guide is for manual / cross-platform setup.

---

## Requirements

- **Python 3.10+**
- **[llama.cpp](https://github.com/ggml-org/llama.cpp)** — specifically the `llama-server` binary
- One or two `.gguf` model files
- Windows / Linux / macOS
- A browser (Chrome, Edge, Firefox)

No Node.js. No npm. No installer.

---

## 1. Install

```bash
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
pip install -r requirements.txt
```

---

## 2. Get llama-server

Download from [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases).

- **Windows**: grab a pre-built ZIP (e.g. `llama-b8855-bin-win-cpu-x64.zip`). Extract anywhere — e.g. `D:/llama/`. The binary is `llama-server.exe`.
- **Linux / macOS**: build from source or use a release binary.

You do **not** need to put `llama-server` in the project folder — just point to it in the Launcher tab.

---

## 3. Get model files

You need `.gguf` model files. Good sources:
- [Hugging Face — GGUF search](https://huggingface.co/models?search=gguf)
- [bartowski's quantized models](https://huggingface.co/bartowski)
- [unsloth's quants](https://huggingface.co/unsloth)

**Main Model (Model A):** anything 7B+. Qwen3, Mistral, LLaMA 3, Gemma, DeepSeek, etc.

**Patcher Model (Model B):** small and fast — 1B–3B. Qwen3-1.7B, SmolLM2-1.7B, Llama-3.2-1B. Speed matters more than quality here.

---

## 4. Launch

```bash
python main.py
```

Browser opens automatically at `http://localhost:7860`.

---

## 5. Launcher tab

**1. Set your llama-server binary** — click Browse… and select `llama-server.exe` (or `llama-server` on Linux/macOS).

**2. Set Main Model (Model A):**
- Browse to your main `.gguf` file
- Adjust extra args if needed (defaults are a good start):
  - `-c 16384` — context length (reduce if low on VRAM)
  - `-ngl 99` — GPU layers (set to `0` for CPU-only)
  - `--flash-attn on` — remove if your GPU doesn't support it
- Port: default `8080`

**3. Set Patcher Model (Model B)** *(optional but recommended)*:
- Check "Enable patcher model (Model B)"
- Browse to a small/fast `.gguf`
- Recommended args: `-c 4096 -ngl 99 -t 4`
- Port: default `8081`

**4. Set Host:** default `0.0.0.0` (all interfaces). Use `127.0.0.1` for local-only.

**5. Click Start.** Status dot: yellow (loading) → green (healthy). Watch the log console for llama-server output.

**To stop:** click **Stop All**.

---

## 6. Profile tab

Fill in your environment once:

| Field | Example |
|-------|---------|
| Shell | PowerShell |
| OS | Windows 11 |
| Python version | 3.12 |
| Package manager | uv |
| Naming convention | snake_case for Python, kebab-case for folders |
| Custom rules | always use uv, never pip / prefer async/await |

Fields auto-save as you type. The profile is injected as a system prompt into every chat request.

---

## 7. Chat tab

### What happens automatically

**Step Extractor** — response is parsed into addressable blocks: `step-1`, `step-2`, `code-block-1`, etc.

**Inline Patcher** — after streaming, every command block is silently sent to the patcher model. Mismatches are rewritten. A green badge appears: `✓ auto-translated → powershell`. Click **↶ undo** to restore the original.

### Error Popup

If a command fails:
1. Click **⚠ Problem?** on the code block
2. Paste your terminal error (or click **📋 Paste from clipboard**)
3. Click **Ask patcher**
4. Review the proposed fix
5. Click **✓ Apply to block**

This costs ~200–400 tokens from the small model. Main conversation context is untouched.

---

## 8. Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Esc` | Close error popup |

---

## 9. Troubleshooting

**"llama-server binary not found"** → Click Browse… on the Launcher tab and point to your binary.

**"File not found: …gguf"** → Path is wrong or drive isn't mounted. Re-browse.

**"Port 8080 is already in use"** → Change the port in the Launcher tab or stop the conflicting process.

**Status stays yellow forever** → Model is still loading. Large models can take 10–60 seconds. Watch the log console.

**VRAM error (red badge)** → Reduce `-ngl 99` (fewer GPU layers), use a more quantized model (Q4 instead of Q8), or reduce `-c 16384`.

**Patcher doesn't fire** → Check Model B is running (green dot) and "Enable patcher model" is checked.

---

## 10. File layout

```
token-saving-replay-agent/
├── main.py              # FastAPI backend (port 7860)
├── portable_launcher.py # Windows portable launcher logic
├── start.bat            # Windows zero-install entry point
├── static/
│   ├── index.html       # UI (Launcher / Chat / Profile tabs)
│   ├── app.ts           # TypeScript source
│   └── app.js           # Compiled JS (no build step needed)
├── requirements.txt
├── config.json          # Last-used settings (auto-written)
└── bin/                 # llama-server.exe lives here (Windows)
```

---

## 11. Recompiling TypeScript (optional)

Only needed if you edit `static/app.ts`:

```bash
npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts
```

Requires Node.js. End users never need this — `app.js` is committed.
