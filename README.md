<div align="center">

# Token Saving Replay Agent

### A tiny local model sits next to your big one and handles the dumb fixes — so your context stays clean.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)](https://python.org)
[![llama.cpp](https://img.shields.io/badge/backend-llama.cpp-green)](https://github.com/ggml-org/llama.cpp)
[![Stars](https://img.shields.io/github/stars/yevgentumanov/token-saving-replay-agent?style=social)](https://github.com/yevgentumanov/token-saving-replay-agent)

</div>

---

## The problem

You're using a big model (70B, Claude, GPT-4o) to walk through a 30-step task. One environment mismatch hits:

1. Model gives you `pip install fastapi` — you use `uv`
2. You paste the error back — model re-reads the entire context
3. It fixes step 3. Step 7 breaks. Repeat.
4. **15,000 tokens burned. Context polluted. You're tired.**

The actual fix needed ~300 tokens. You spent 15,000.

---

## The solution

A **small model (1–3B)** runs beside your big one. It handles micro-fixes in real time — shell translations, path corrections, missing `sudo`, version mismatches — **without touching the main model's context at all.**

> Big model stays focused on hard thinking.  
> Small model handles the mechanical noise.

<!-- SCREENSHOT: split terminal showing two llama-server instances running side by side -->

---

## Quick start — Windows (zero-install)

> No Python needed on your system. No admin rights. No Docker. Just Git.

```bat
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
start.bat
```

**That's it.** On first run, `start.bat` does everything automatically:

| Step | What happens |
|------|-------------|
| 1 | Downloads portable Python 3.12 (~7 MB) into `./python/` |
| 2 | Installs Python dependencies from `requirements.txt` |
| 3 | Downloads `llama-server.exe` (b8855, Windows x64 CPU) into `./bin/` |
| 4 | Opens a file dialog — pick your **main** `.gguf` model |
| 5 | Opens a file dialog — pick your **patcher** `.gguf` model |
| 6 | Launches both servers and opens `http://localhost:7860` in your browser |

**Subsequent runs:** `start.bat` skips all setup and goes straight to the app.

<!-- GIF: start.bat running for the first time — progress log scrolling, then browser opening -->

**Requirements:** Windows 10/11 · ~500 MB free space · internet on first run only

**Not required:** Python · admin rights · Docker · npm · anything else

---

## Quick start — Manual / cross-platform

```bash
git clone https://github.com/yevgentumanov/token-saving-replay-agent.git
cd token-saving-replay-agent
pip install -r requirements.txt
python main.py
```

You also need `llama-server` from [llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) and one or two `.gguf` model files. Point to them in the Launcher tab.

See **[INSTRUCTIONS.md](./INSTRUCTIONS.md)** for the full manual setup guide.

---

## How it works

### 🗂 Environment Profile
Fill in your setup once: shell, OS, Python version, package manager, custom rules. This becomes a system prompt automatically prepended to every request. The main model already knows you use PowerShell + `uv` before you type a word.

### ⚡ Inline Patcher
After the main model responds, the patcher model silently scans every command block. Mismatches get rewritten automatically:

```
pip install fastapi  →  uv add fastapi
mkdir -p foo/bar     →  mkdir foo\bar -Force
```

A small badge appears. One click to undo.

<!-- SCREENSHOT: chat response with a green "✓ auto-translated → powershell" badge on a code block -->

### 🔧 Error Popup
A command failed? Click **⚠ Problem?** on the code block, paste the stderr, click **Ask patcher**. The small model sees only that one block + your error — not the full conversation. Fix proposed in ~1 second. Apply directly.

<!-- SCREENSHOT: error popup modal with pasted stderr and proposed fix -->

### 🔢 Step Extractor
Every response is parsed into addressable blocks (`step-1`, `code-block-3`). Foundation for the Consolidation Pass coming in Phase 2.5.

---

## Token savings

| Scenario | Without | With |
|----------|---------|------|
| Wrong shell in 1 block | Re-send full context (~5k tokens) | Patcher call (~300 tokens) |
| Error on step 5 of 10 | Re-explain + full context (~8k tokens) | Error popup (~400 tokens) |
| 3 env mismatches in one reply | 3× full re-sends (~15k tokens) | 3× parallel patcher calls (~900 tokens) |

**Typical savings on a 30-step technical task: 70–90% of micro-fix tokens.**

---

## Model recommendations

**Main Model (Model A)** — any capable model works:
- Qwen3-14B, Qwen2.5-32B, Mistral-7B, LLaMA-3.1-8B, DeepSeek-R1-14B
- Q5 or Q8 quantization for best quality

**Patcher Model (Model B)** — small and fast is what matters:
- Qwen3-1.7B, Qwen2.5-1.5B, SmolLM2-1.7B, Llama-3.2-1B
- Speed > capability — it only handles one block at a time
- **Thinking models work fine** — Token Saving Replay Agent sends `/no_think` automatically to skip chain-of-thought. If the model ignores it, answers are extracted from `reasoning_content` as a fallback.

Both run locally via llama.cpp. **No API keys. No cloud. No usage costs.**

---

## Architecture

```
Browser (localhost:7860)
  └── FastAPI (main.py)
        ├── /api/chat/main    ──► llama-server A (port 8080) — big model
        ├── /api/chat/patcher  ──► llama-server B (port 8081) — small patcher
        ├── /api/start         — launches llama-server subprocesses
        ├── /api/status        — health check (pings /v1/models every 4s)
        └── /ws/logs           — streams llama-server stdout in real time
```

Frontend: pure HTML + TypeScript, no framework, no build step. Compiled `app.js` is committed — end users need nothing.

---

## Project status

| Phase | Feature | Status |
|-------|---------|--------|
| 0 | Basic launcher — GUI, llama-server subprocess, health check | ✅ Done |
| 1 | Dual model launcher — Main + Patcher, independent health checks | ✅ Done |
| 2 | Core — Chat, Profile, Inline Patcher, Error Popup | ✅ Done |
| — | Thinking model support — `/no_think` + `reasoning_content` fallback | ✅ Done |
| — | Portable Windows launcher — zero-install `start.bat` | ✅ Done |
| 2.5 | Consolidation Pass — summarise patches before next big-model call | 🔜 Next |
| 3+ | Full Step Extractor, escalation formatter, cross-platform installer | 📋 Planned |

---

## Contributing

Issues and PRs welcome.

- **Something broke** → open an issue with the log console output
- **Better patcher prompt** → open a PR, I'm actively iterating on it
- **Model that works well / badly** → share in issues

---

## Author

[@euusome](https://x.com/euusome) — building tools for local LLM users.

---

## License

Apache 2.0 — use, modify, distribute freely.

---

*Built for people who actually run models locally.*
