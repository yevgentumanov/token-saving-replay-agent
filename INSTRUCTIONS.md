# Installation & Usage Guide

## Requirements

- **Python 3.10+**
- **[llama.cpp](https://github.com/ggerganov/llama.cpp)** — specifically the `llama-server` binary
- A `.gguf` model file (one or two — see below)
- Windows / Linux / macOS
- A browser (Chrome, Edge, Firefox)

No Node.js needed. No npm. No installer.

---

## 1. Install

```bash
git clone https://github.com/euusome/operational-mode.git
cd operational-mode
pip install -r requirements.txt
```

That's it.

---

## 2. Get llama-server

You need `llama-server` from [llama.cpp](https://github.com/ggerganov/llama.cpp/releases).

- **Windows**: download a pre-built release ZIP (e.g. `llama-b…-bin-win-vulkan-x64.zip`). Extract it anywhere — e.g. `D:/llama-vulkan/`. The binary is `llama-server.exe`.
- **Linux / macOS**: build from source or use a release binary.

You do **not** need to put `llama-server` in the same folder as this project.

---

## 3. Get a model

You need `.gguf` model files. Good sources:
- [Hugging Face — GGUF search](https://huggingface.co/models?search=gguf)
- [bartowski's quantized models](https://huggingface.co/bartowski)
- [unsloth's quants](https://huggingface.co/unsloth)

**For Main Model (Model A)** — use anything 7B+. Qwen3, Mistral, LLaMA 3, Gemma, DeepSeek, etc.

**For Patcher Model (Model B)** — use a small fast model: 1B–3B. Qwen2.5-1.5B, SmolLM2-1.7B, Llama-3.2-1B, etc. Speed matters more than quality for this role.

---

## 4. Launch

```bash
python main.py
```

Your browser opens automatically at `http://localhost:7860`.

---

## 5. Launcher Tab — Start your models

The first tab is the **Launcher**. This is where you configure and start `llama-server`.

### Step-by-step:

**1. Set your llama-server binary:**
   - Click **Browse…** next to "llama-server binary"
   - Navigate to your `llama-server.exe` (or `llama-server` on Linux/macOS)
   - Select it — path saved automatically

**2. Set Main Model (Model A):**
   - Click **Browse…** next to "Model (.gguf)" under "Main Model"
   - Select your main `.gguf` file
   - Adjust **Extra arguments** if needed (defaults are a good start):
     - `-c 16384` — context length (reduce if you're low on VRAM)
     - `-ngl 99` — GPU layers (set to 0 for CPU-only)
     - `--flash-attn on` — faster attention (remove if your GPU doesn't support it)
   - **Port**: default `8080` — change only if it's in use

**3. (Optional) Set Patcher Model (Model B):**
   - Check "Enable patcher model (Model B)"
   - Browse to a small/fast `.gguf` model
   - Recommended args: `-c 4096 -ngl 99 -t 4`
   - Port: default `8081`

**4. Set Host:**
   - Default `0.0.0.0` (listens on all interfaces). Use `127.0.0.1` for local-only.

**5. Click Start:**
   - The status dot turns yellow (starting) → green (healthy, /v1/models responding)
   - Log console shows llama-server output in real time
   - "Open Main in llama-server UI ↗" button appears — use this to access llama-server's built-in chat if you prefer it

**To stop:** click **Stop All**. Both processes are terminated.

---

## 6. Profile Tab — Tell the tool about your environment

Before chatting, go to the **Profile** tab and fill in your environment once:

| Field | What to put |
|-------|------------|
| Shell | Your terminal — PowerShell, cmd, bash, zsh… |
| OS | Windows / Linux / macOS |
| Python version | e.g. `3.11` |
| Package manager | uv, pip, conda, npm… |
| Naming convention | e.g. `snake_case for python, kebab-case for folders` |
| Custom rules | One rule per line — e.g. `always use uv, never pip` / `use venv` / `prefer async/await` |

**Fields auto-save as you type.** The profile is injected as a system prompt into every chat request, so the main model already knows your setup before you ask anything.

---

## 7. Chat Tab — Operational Mode in action

Click the **Chat** tab. You'll see a chat interface connected to Model A.

### Sending a message

Type your request and press **Enter** (or **Shift+Enter** for a newline). The response streams in real time.

### What happens automatically

**Step Extractor** — the response is parsed into addressable blocks:
- Headers and numbered list items get IDs like `step-1`, `step-2`
- Code blocks get IDs like `code-block-1`, `code-block-2`

**Inline Patcher** (requires Model B running) — after streaming completes, every command block (bash, sh, cmd, powershell, batch, zsh, fish…) is silently sent to the patcher model.
- If the command doesn't match your shell/rules, it's automatically rewritten
- A green badge appears: `✓ auto-translated → powershell`
- **↶ undo** button restores the original if needed

### Copy button

Every code block has a **Copy** button in its header. Click to copy the command to clipboard.

### Error Popup — fixing a specific step

If a command fails in your terminal:

1. Click **⚠ Problem?** button in the code block header
2. A modal opens showing the block content
3. Paste your terminal error — type it, or click **📋 Paste from clipboard**
4. Click **Ask patcher**
5. The patcher model responds with a proposed fix + one-line explanation
6. Click **✓ Apply to block** to replace the block content

This costs ~200 tokens from the small patcher model, not the main model. Your main conversation context is untouched.

### Clear conversation

Click **Clear** to start a fresh session. (Chat history persists in `sessionStorage` — survives page refresh, cleared when you close the tab.)

---

## 8. Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Esc` | Close error popup modal |

---

## 9. Troubleshooting

**"llama-server binary not found"**
→ Click Browse… on the Launcher tab and point to your `llama-server.exe`

**"File not found: …gguf"**
→ The path in the model field is wrong or the drive isn't mounted. Re-browse.

**"Port 8080 is already in use"**
→ Something else is using that port. Change the port in the Launcher tab or stop the conflicting process.

**Status stays yellow (Starting…) forever**
→ llama-server is still loading the model. Large models can take 10–60 seconds. Watch the log console.

**VRAM Error badge (red)**
→ The model doesn't fit in VRAM. Try:
- Reduce `-ngl 99` to a lower number (fewer GPU layers)
- Use a more quantized model (Q4 instead of Q8)
- Reduce `-c 16384` (context length)

**Patcher doesn't fire**
→ Check that Model B is running (green dot) and "Enable patcher model" is checked.

**"Patcher model (B) is not running"**
→ Go back to Launcher tab, add a Model B path, and click Start.

**Chat tab says "Main Model (A) is not running"**
→ Start Model A first from the Launcher tab.

---

## 10. File layout

```
operational-mode/
├── main.py              # FastAPI backend (port 7860)
├── static/
│   ├── index.html       # UI (3 tabs: Launcher, Chat, Profile)
│   ├── app.ts           # TypeScript source
│   └── app.js           # Compiled JS (no build step needed)
├── requirements.txt
├── config.json          # Last-used settings (auto-written)
├── WORKLOG.md           # Your session notes
└── roadmap.md           # Development roadmap
```

`config.json` is written automatically when you click Start. You can edit it manually if needed.

---

## 11. Recompiling the TypeScript (optional)

If you edit `static/app.ts`, recompile with:

```bash
npx tsc --target ES2020 --lib ES2020,DOM --strict --outDir static static/app.ts
```

Requires Node.js. End users don't need this — `app.js` is already committed.
